import { NextResponse } from "next/server";
import { fetchOptionSnapshot } from "@/lib/api";
import { requireMarketAccess } from "@/lib/routeAccess";
import {
  build42LegOptionChain,
  clampToClosedMinute,
  getPreviousTradingDayTimestampCandidates,
  hasSnapshotOptionData,
  normalizeTimestamp
} from "@/app/api/options/_chainUtils";

const LIVE_OI_CACHE_TTL_MS = 15 * 1000;
const LIVE_OI_STALE_MAX_AGE_MS = 2 * 60 * 1000;
const LIVE_OI_SNAPSHOT_TIMEOUT_MS = 8500;
const LIVE_OI_MAX_PROBE_CANDIDATES = 2;
const LIVE_OI_MAX_TOTAL_RESOLVE_MS = 9500;
const LIVE_OI_REQUEST_BUDGET_MS = 10000;
const SUPPORTED_OPTION_SYMBOLS = new Set(["NIFTY"]);
const liveOiCache = new Map();
const liveOiInflight = new Map();

function withTimeout(promise, timeoutMs, message) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

async function fetchOptionSnapshotWithTimeout({ symbol, ts, timeoutMs }) {
  const resolvedTimeoutMs = Math.max(300, Number(timeoutMs) || LIVE_OI_SNAPSHOT_TIMEOUT_MS);
  try {
    return await withTimeout(fetchOptionSnapshot({
      symbol,
      ts,
      timeoutMs: resolvedTimeoutMs,
      historical: true
    }), resolvedTimeoutMs, "live_oi snapshot timeout");
  } catch (error) {
    if (String(error?.name || "").toLowerCase() === "aborterror" && Number(timeoutMs) > 0) {
      throw new Error("live_oi request timeout");
    }
    throw error;
  }
}

function logLiveOi(stage, details = {}) {
  try {
    console.info(`[api/options/live_oi] ${stage}`, details);
  } catch {
    // no-op
  }
}

function classifyLiveOiError(error) {
  const statusFromError = Number(error?.status);
  if (Number.isFinite(statusFromError) && statusFromError > 0) {
    return statusFromError;
  }
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("timeout") || message.includes("aborted")) {
    return 504;
  }
  if (message.includes("unsupported option symbol") || message.includes("invalid")) {
    return 400;
  }
  if (message.includes("no option chain data") || message.includes("not found") || message.includes("no candles")) {
    return 404;
  }
  return 502;
}

function normalizeOptionSymbol(raw) {
  const normalized = String(raw || "NIFTY").trim().toUpperCase();
  if (!SUPPORTED_OPTION_SYMBOLS.has(normalized)) {
    return "";
  }
  return normalized;
}

function normalizeExpiry(raw) {
  return String(raw || "").trim();
}

function hasNonEmptyLivePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const dataCount = payload.data && typeof payload.data === "object"
    ? Object.keys(payload.data).length
    : 0;
  return dataCount > 0;
}

function buildLiveOiErrorPayload({
  status = 502,
  message = "Failed to fetch live OI snapshot"
}) {
  return {
    error: {
      status,
      message
    },
    atmStrike: 0,
    data: {}
  };
}

function findRecentLiveOiCacheBySymbol(symbol, requestedExpiry = "") {
  const normalizedSymbol = String(symbol || "").toUpperCase();
  const normalizedExpiry = normalizeExpiry(requestedExpiry);
  const nowMs = Date.now();
  let best = null;

  for (const [key, entry] of liveOiCache.entries()) {
    const [entrySymbol = "", entryExpiry = ""] = String(key).split(":");
    if (String(entrySymbol).toUpperCase() !== normalizedSymbol) {
      continue;
    }
    if (normalizedExpiry && normalizeExpiry(entryExpiry) !== normalizedExpiry) {
      continue;
    }
    if (!hasNonEmptyLivePayload(entry?.payload)) {
      continue;
    }
    const createdAt = entry.expiresAt - LIVE_OI_CACHE_TTL_MS;
    if ((nowMs - createdAt) > LIVE_OI_STALE_MAX_AGE_MS) {
      continue;
    }
    if (!best || createdAt > best.createdAt) {
      best = {
        payload: entry.payload,
        createdAt
      };
    }
  }

  return best ? { ...(best.payload || {}) } : null;
}

function buildLiveOiPayload({
  snapshot
}) {
  const chain = build42LegOptionChain(snapshot);

  return {
    atmStrike: chain.atmStrike,
    data: chain.oiBySymbol
  };
}

function buildProbeTimestampList(requestTimestamp) {
  const requestTs = normalizeTimestamp(requestTimestamp);
  const previousTradingCandidates = getPreviousTradingDayTimestampCandidates(requestTimestamp, 5);
  const base = [
    requestTs,
    Number.isFinite(requestTs) ? requestTs - 60 : null,
    ...previousTradingCandidates
  ].filter((value) => Number.isFinite(value) && value > 0);

  const out = [];
  const seen = new Set();
  for (const rawTs of base) {
    const candidate = clampToClosedMinute(rawTs);
    if (!candidate || candidate <= 0 || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    out.push(candidate);
    if (out.length >= LIVE_OI_MAX_PROBE_CANDIDATES) {
      break;
    }
  }

  return out;
}

async function resolveSnapshotWithTradingFallback({
  symbol,
  requestTimestamp,
  timeoutMs = LIVE_OI_SNAPSHOT_TIMEOUT_MS
}) {
  const candidates = buildProbeTimestampList(requestTimestamp);
  let lastError = null;
  const attemptedTimestamps = [];
  const startedAt = Date.now();

  for (const candidateTs of candidates) {
    if ((Date.now() - startedAt) >= LIVE_OI_MAX_TOTAL_RESOLVE_MS) {
      break;
    }
    attemptedTimestamps.push(candidateTs);
    try {
      const snapshot = await fetchOptionSnapshotWithTimeout({ symbol, ts: candidateTs, timeoutMs });
      const resolvedTimestamp = normalizeTimestamp(snapshot?.timestamp) || candidateTs;
      if (!hasSnapshotOptionData(snapshot)) {
        continue;
      }
      return {
        snapshot,
        resolvedTimestamp,
        fallbackApplied: candidateTs !== normalizeTimestamp(requestTimestamp),
        attemptedTimestamps
      };
    } catch (error) {
      lastError = error;
    }
  }

  const error = lastError || new Error("No option chain data found for requested timestamp and fallback window");
  error.attemptedTimestamps = attemptedTimestamps;
  throw error;
}

async function serveLiveOi({ symbol, ts, expiry = "" }) {
  const normalizedExpiry = normalizeExpiry(expiry);
  const cacheKey = `${String(symbol || "NIFTY").toUpperCase()}:${normalizedExpiry || "auto"}:${ts}`;
  const now = Date.now();
  const cached = liveOiCache.get(cacheKey);
  if (cached && cached.expiresAt > now && hasNonEmptyLivePayload(cached.payload)) {
    return cached.payload;
  }

  if (liveOiInflight.has(cacheKey)) {
    return liveOiInflight.get(cacheKey);
  }

  const promise = resolveSnapshotWithTradingFallback({
    symbol,
    requestTimestamp: ts,
    timeoutMs: LIVE_OI_SNAPSHOT_TIMEOUT_MS
  }).then((resolved) => {
      const payloadBase = buildLiveOiPayload({
        snapshot: resolved.snapshot
      });
      if (!hasNonEmptyLivePayload(payloadBase)) {
        const noDataError = new Error("Resolved option snapshot has no chain data");
        noDataError.attemptedTimestamps = resolved.attemptedTimestamps;
        throw noDataError;
      }
      const payload = payloadBase;
      liveOiCache.set(cacheKey, {
        payload,
        expiresAt: Date.now() + LIVE_OI_CACHE_TTL_MS
      });
      if (liveOiCache.size > 48) {
        const firstKey = liveOiCache.keys().next().value;
        liveOiCache.delete(firstKey);
      }
      return payload;
    }).finally(() => {
    liveOiInflight.delete(cacheKey);
  });

  liveOiInflight.set(cacheKey, promise);
  return promise;
}

export async function GET(request) {
  const startedAt = Date.now();
  const auth = await requireMarketAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const params = request.nextUrl.searchParams;
  const rawSymbol = params.get("symbol") || "NIFTY";
  const symbol = normalizeOptionSymbol(rawSymbol);
  const expiry = normalizeExpiry(params.get("expiry"));
  const requestedTs = params.get("ts") || params.get("time") || params.get("latestTs");
  const ts = clampToClosedMinute(requestedTs);

  logLiveOi("request", {
    path: request.nextUrl.pathname,
    symbol: rawSymbol,
    normalizedSymbol: symbol || null,
    expiry: expiry || null,
    requestedTs: requestedTs || null,
    clampedTs: ts || null
  });

  if (!symbol) {
    return NextResponse.json(
      { error: `unsupported symbol: ${rawSymbol}` },
      { status: 400 }
    );
  }
  if (!requestedTs) {
    return NextResponse.json({ error: "ts query param is required" }, { status: 400 });
  }
  if (!ts) {
    return NextResponse.json({ error: "ts is required" }, { status: 400 });
  }

  try {
    const payload = await withTimeout(
      serveLiveOi({ symbol, ts, expiry }),
      LIVE_OI_REQUEST_BUDGET_MS,
      "live_oi request timeout"
    );
    logLiveOi("success", {
      symbol,
      expiry: expiry || null,
      requestTimestamp: ts,
      atmStrike: Number(payload?.atmStrike || 0),
      dataKeys: payload?.data && typeof payload.data === "object" ? Object.keys(payload.data).length : 0,
      durationMs: Date.now() - startedAt
    });
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    const stale = findRecentLiveOiCacheBySymbol(symbol, expiry);
    if (stale) {
      logLiveOi("stale_cache_hit", {
        symbol,
        expiry: expiry || null,
        requestTimestamp: ts,
        atmStrike: Number(stale?.atmStrike || 0),
        durationMs: Date.now() - startedAt
      });
      return NextResponse.json(stale, { status: 200 });
    }
    const status = classifyLiveOiError(error);
    const message = error?.message || "Failed to fetch live OI snapshot";
    logLiveOi("error", {
      status,
      symbol,
      expiry: expiry || null,
      requestTimestamp: ts,
      durationMs: Date.now() - startedAt,
      attemptedTimestamps: Array.isArray(error?.attemptedTimestamps) ? error.attemptedTimestamps : []
    });
    const errorPayload = buildLiveOiErrorPayload({
      status,
      message
    });
    if (status >= 500) {
      return NextResponse.json(errorPayload, { status: 200 });
    }
    return NextResponse.json(errorPayload, { status });
  }
}
