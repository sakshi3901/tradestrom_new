import { NextResponse } from "next/server";
import { fetchOptionSnapshot } from "@/lib/api";
import { requireMarketAccess } from "@/lib/routeAccess";
import {
  clampToClosedMinute,
  getClosedMinuteCutoffIST,
  getPreviousTradingDayTimestampCandidates,
  hasSnapshotOptionData,
  normalizeTimestamp
} from "@/app/api/options/_chainUtils";

const OPTION_SNAPSHOT_CACHE_TTL_MS = 15 * 1000;
const OPTION_SNAPSHOT_STALE_MAX_AGE_MS = 2 * 60 * 1000;
const OPTION_SNAPSHOT_FETCH_TIMEOUT_MS = 8500;
const OPTION_SNAPSHOT_MAX_PROBE_CANDIDATES = 8;
const SUPPORTED_OPTION_SYMBOLS = new Set(["NIFTY"]);
const optionSnapshotCache = new Map();
const optionSnapshotInflight = new Map();

function logOptionSnapshotRequest(stage, request, details = {}) {
  try {
    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    console.info(`[api/options/snapshot] ${stage}`, {
      method: request.method,
      path: request.nextUrl.pathname,
      params,
      ...details
    });
  } catch {
    // no-op
  }
}

function classifyOptionSnapshotError(error) {
  const statusFromError = Number(error?.status);
  if (Number.isFinite(statusFromError) && statusFromError > 0) {
    return statusFromError;
  }
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("timeout") || message.includes("aborted")) {
    return 504;
  }
  if (message.includes("no candles") || message.includes("not found") || message.includes("unsupported option symbol")) {
    return 404;
  }
  if (message.includes("required") || message.includes("invalid") || message.includes("unsupported")) {
    return 400;
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

async function fetchOptionSnapshotWithTimeout({ symbol, ts, timeoutMs }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetchOptionSnapshot({
      symbol,
      ts,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("option snapshot request timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function hasNonEmptySnapshotPayload(payload) {
  return hasSnapshotOptionData(payload);
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
    if (out.length >= OPTION_SNAPSHOT_MAX_PROBE_CANDIDATES) {
      break;
    }
  }
  return out;
}

function buildSnapshotPayload({
  requestTimestamp,
  requestedExpiry = "",
  snapshot,
  fallbackApplied = false,
  attemptedTimestamps = []
}) {
  const resolvedTimestamp = normalizeTimestamp(snapshot?.timestamp) || requestTimestamp;
  return {
    ...(snapshot || {}),
    requestTimestamp,
    resolvedTimestamp,
    exactMatch: resolvedTimestamp === requestTimestamp,
    requestedExpiry: normalizeExpiry(requestedExpiry),
    resolvedExpiry: String(snapshot?.expiry || ""),
    fallbackApplied: Boolean(fallbackApplied),
    attemptedTimestamps
  };
}

async function resolveSnapshotWithFallback({
  symbol,
  requestTimestamp,
  requestedExpiry = "",
  timeoutMs = OPTION_SNAPSHOT_FETCH_TIMEOUT_MS
}) {
  const candidates = buildProbeTimestampList(requestTimestamp);
  const attemptedTimestamps = [];
  let lastError = null;

  for (const candidateTs of candidates) {
    attemptedTimestamps.push(candidateTs);
    try {
      const snapshot = await fetchOptionSnapshotWithTimeout({ symbol, ts: candidateTs, timeoutMs });
      if (!hasSnapshotOptionData(snapshot)) {
        continue;
      }
      return buildSnapshotPayload({
        requestTimestamp,
        requestedExpiry,
        snapshot,
        fallbackApplied: candidateTs !== normalizeTimestamp(requestTimestamp),
        attemptedTimestamps
      });
    } catch (error) {
      lastError = error;
    }
  }

  const error = lastError || new Error("No option chain data found for requested timestamp and fallback window");
  error.attemptedTimestamps = attemptedTimestamps;
  throw error;
}

function findRecentSnapshotCacheForSymbol(symbol, requestedExpiry, nowMs) {
  const symbolPrefix = `${String(symbol || "").toUpperCase()}:`;
  const normalizedExpiry = normalizeExpiry(requestedExpiry);
  let best = null;
  for (const [key, entry] of optionSnapshotCache.entries()) {
    if (!String(key).startsWith(symbolPrefix)) {
      continue;
    }
    const keyParts = String(key).split(":");
    const entryExpiry = normalizeExpiry(keyParts?.[1] || "");
    if (normalizedExpiry && entryExpiry !== normalizedExpiry) {
      continue;
    }
    if (!hasNonEmptySnapshotPayload(entry?.payload)) {
      continue;
    }
    const createdAt = entry.expiresAt - OPTION_SNAPSHOT_CACHE_TTL_MS;
    if ((nowMs - createdAt) > OPTION_SNAPSHOT_STALE_MAX_AGE_MS) {
      continue;
    }
    if (!best || createdAt > best.createdAt) {
      best = {
        payload: entry.payload,
        createdAt
      };
    }
  }
  return best ? best.payload : null;
}

async function serveSnapshot({ symbol, ts, requestedExpiry = "" }) {
  const normalizedExpiry = normalizeExpiry(requestedExpiry);
  const cacheKey = `${String(symbol).toUpperCase()}:${normalizedExpiry || "auto"}:${ts}`;
  const now = Date.now();
  const cached = optionSnapshotCache.get(cacheKey);
  if (cached && cached.expiresAt > now && hasNonEmptySnapshotPayload(cached.payload)) {
    return cached.payload;
  }

  if (optionSnapshotInflight.has(cacheKey)) {
    return optionSnapshotInflight.get(cacheKey);
  }

  const promise = resolveSnapshotWithFallback({
    symbol,
    requestTimestamp: ts,
    requestedExpiry: normalizedExpiry,
    timeoutMs: OPTION_SNAPSHOT_FETCH_TIMEOUT_MS
  }).then((payloadBase) => {
      if (!hasNonEmptySnapshotPayload(payloadBase)) {
        const noDataError = new Error("Resolved option snapshot has no chain data");
        noDataError.attemptedTimestamps = payloadBase?.attemptedTimestamps || [];
        throw noDataError;
      }
      const expiryMismatch = normalizedExpiry
        && payloadBase.resolvedExpiry
        && normalizeExpiry(payloadBase.resolvedExpiry) !== normalizedExpiry;
      const payload = expiryMismatch
        ? {
          ...payloadBase,
          warning: `requested_expiry:${normalizedExpiry} resolved_expiry:${payloadBase.resolvedExpiry}`,
          partial: true
        }
        : payloadBase;

      optionSnapshotCache.set(cacheKey, {
        payload,
        expiresAt: Date.now() + OPTION_SNAPSHOT_CACHE_TTL_MS
      });
      if (optionSnapshotCache.size > 96) {
        const firstKey = optionSnapshotCache.keys().next().value;
        optionSnapshotCache.delete(firstKey);
      }
      return payload;
    }).finally(() => {
    optionSnapshotInflight.delete(cacheKey);
  });

  optionSnapshotInflight.set(cacheKey, promise);
  return promise;
}

export async function GET(request) {
  logOptionSnapshotRequest("request", request);
  const auth = await requireMarketAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const params = request.nextUrl.searchParams;
  const rawSymbol = params.get("symbol") || "NIFTY";
  const symbol = normalizeOptionSymbol(rawSymbol);
  const requestedExpiry = normalizeExpiry(params.get("expiry"));
  const requestedTs = params.get("ts") || params.get("time") || params.get("latestTs");
  const closedCutoff = getClosedMinuteCutoffIST();
  const ts = clampToClosedMinute(requestedTs || closedCutoff);

  if (!symbol) {
    logOptionSnapshotRequest("bad_request", request, { reason: "unsupported_symbol", symbol: rawSymbol });
    return NextResponse.json({ error: `unsupported symbol: ${rawSymbol}` }, { status: 400 });
  }
  if (!ts) {
    logOptionSnapshotRequest("bad_request", request, { reason: "no closed candle available" });
    return NextResponse.json({ error: "ts is required" }, { status: 400 });
  }

  logOptionSnapshotRequest("resolved_request", request, {
    symbol,
    requestedExpiry: requestedExpiry || null,
    requestedTs: requestedTs || null,
    clampedTs: ts
  });

  try {
    const payload = await serveSnapshot({ symbol, ts, requestedExpiry });
    logOptionSnapshotRequest("success", request, {
      symbol,
      requestedExpiry: requestedExpiry || null,
      requestTimestamp: ts,
      resolvedTimestamp: payload?.resolvedTimestamp || 0,
      strikes: Array.isArray(payload?.strikes) ? payload.strikes.length : 0,
      rows: Array.isArray(payload?.rows) ? payload.rows.length : 0,
      dataKeys: payload?.data && typeof payload.data === "object" ? Object.keys(payload.data).length : 0,
      fallbackApplied: Boolean(payload?.fallbackApplied),
      exactMatch: Boolean(payload?.exactMatch)
    });
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    const now = Date.now();
    const staleBySymbol = findRecentSnapshotCacheForSymbol(symbol, requestedExpiry, now);
    if (staleBySymbol) {
      logOptionSnapshotRequest("stale_cache_hit", request, {
        symbol,
        requestedExpiry: requestedExpiry || null,
        requestTimestamp: ts
      });
      return NextResponse.json({ ...staleBySymbol, stale: true }, { status: 200 });
    }
    const status = classifyOptionSnapshotError(error);
    const message = error?.message || "Failed to fetch option snapshot";
    logOptionSnapshotRequest("error", request, {
      status,
      message,
      symbol,
      requestedExpiry: requestedExpiry || null,
      requestTimestamp: ts,
      latestClosedTimestamp: closedCutoff,
      attemptedTimestamps: Array.isArray(error?.attemptedTimestamps) ? error.attemptedTimestamps : []
    });
    return NextResponse.json(
      {
        error: message,
        details: {
          symbol,
          expiry: requestedExpiry || null,
          requestTimestamp: ts,
          latestClosedTimestamp: closedCutoff,
          attemptedTimestamps: Array.isArray(error?.attemptedTimestamps) ? error.attemptedTimestamps : []
        }
      },
      { status }
    );
  }
}
