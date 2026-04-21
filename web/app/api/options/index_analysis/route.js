import { NextResponse } from "next/server";
import { fetchOptionSnapshot } from "@/lib/api";
import { requireMarketAccess } from "@/lib/routeAccess";
import {
  build42LegOptionChain,
  clampToClosedMinute,
  getClosedMinuteCutoffIST,
  getPreviousTradingDayTimestampCandidates,
  hasSnapshotOptionData,
  normalizeTimestamp
} from "@/app/api/options/_chainUtils";

const INDEX_ANALYSIS_CACHE_TTL_MS = 20 * 1000;
const INDEX_ANALYSIS_STALE_MAX_AGE_MS = 2 * 60 * 1000;
const INDEX_ANALYSIS_SNAPSHOT_TIMEOUT_MS = 8500;
const INDEX_ANALYSIS_MAX_PROBE_CANDIDATES = 2;
const INDEX_ANALYSIS_MAX_TOTAL_RESOLVE_MS = 9500;
const INDEX_ANALYSIS_REQUEST_BUDGET_MS = 10000;
const SUPPORTED_OPTION_SYMBOLS = new Set(["NIFTY"]);
const indexAnalysisCache = new Map();
const indexAnalysisInflight = new Map();

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
  const resolvedTimeoutMs = Math.max(300, Number(timeoutMs) || INDEX_ANALYSIS_SNAPSHOT_TIMEOUT_MS);
  try {
    return await withTimeout(fetchOptionSnapshot({
      symbol,
      ts,
      timeoutMs: resolvedTimeoutMs,
      historical: true
    }), resolvedTimeoutMs, "index_analysis snapshot timeout");
  } catch (error) {
    if (String(error?.name || "").toLowerCase() === "aborterror" && Number(timeoutMs) > 0) {
      throw new Error("index_analysis request timeout");
    }
    throw error;
  }
}

function logIndexAnalysis(stage, details = {}) {
  try {
    console.info(`[api/options/index_analysis] ${stage}`, details);
  } catch {
    // no-op
  }
}

function classifyIndexAnalysisError(error) {
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

function hasNonEmptyIndexAnalysisPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const data = payload.data;
  if (!data || typeof data !== "object") {
    return false;
  }
  const values = Object.values(data).filter((item) => item && typeof item === "object" && !Array.isArray(item));
  if (values.length === 0) {
    return false;
  }
  return values.some((item) => Object.keys(item).length > 0);
}

function buildIndexAnalysisErrorPayload({
  startTimestamp,
  endTimestamp,
  status = 502,
  message = "Failed to fetch index analysis"
}) {
  const ts1 = Number(startTimestamp || 0);
  const ts2 = Number(endTimestamp || ts1 || 0);
  return {
    error: {
      status,
      message
    },
    data: {
      [String(ts1)]: {},
      [String(ts2)]: {}
    }
  };
}

function buildIndexAnalysisFallbackPayload({
  startTimestamp,
  endTimestamp
}) {
  const ts1 = Number(startTimestamp || 0);
  const ts2 = Number(endTimestamp || ts1 || 0);
  return {
    data: {
      [String(ts1)]: {},
      [String(ts2)]: {}
    }
  };
}

function findRecentIndexAnalysisCacheBySymbol(symbol, requestedExpiry = "") {
  const normalizedSymbol = String(symbol || "").toUpperCase();
  const normalizedExpiry = normalizeExpiry(requestedExpiry);
  const nowMs = Date.now();
  let best = null;

  for (const [key, entry] of indexAnalysisCache.entries()) {
    const [entrySymbol = "", entryExpiry = ""] = String(key).split(":");
    if (String(entrySymbol).toUpperCase() !== normalizedSymbol) {
      continue;
    }
    if (normalizedExpiry && normalizeExpiry(entryExpiry) !== normalizedExpiry) {
      continue;
    }
    if (!hasNonEmptyIndexAnalysisPayload(entry?.payload)) {
      continue;
    }
    const createdAt = entry.expiresAt - INDEX_ANALYSIS_CACHE_TTL_MS;
    if ((nowMs - createdAt) > INDEX_ANALYSIS_STALE_MAX_AGE_MS) {
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

function parseBodyTimestamps(body) {
  const startRaw = body?.startTimestamp ?? body?.from ?? body?.ts1 ?? body?.start;
  const endRaw = body?.endTimestamp ?? body?.to ?? body?.ts2 ?? body?.end;
  return {
    hasStart: !(startRaw === undefined || startRaw === null || String(startRaw).trim() === ""),
    hasEnd: !(endRaw === undefined || endRaw === null || String(endRaw).trim() === ""),
    start: clampToClosedMinute(startRaw),
    end: clampToClosedMinute(endRaw)
  };
}

function parseQueryTimestamps(searchParams) {
  const startRaw = searchParams.get("startTimestamp")
    || searchParams.get("from")
    || searchParams.get("ts1")
    || searchParams.get("start");
  const endRaw = searchParams.get("endTimestamp")
    || searchParams.get("to")
    || searchParams.get("ts2")
    || searchParams.get("end");
  return {
    hasStart: !(startRaw === undefined || startRaw === null || String(startRaw).trim() === ""),
    hasEnd: !(endRaw === undefined || endRaw === null || String(endRaw).trim() === ""),
    start: clampToClosedMinute(startRaw),
    end: clampToClosedMinute(endRaw)
  };
}

function buildPayload({
  startTimestamp,
  endTimestamp,
  startSnapshot,
  endSnapshot
}) {
  const startChain = build42LegOptionChain(startSnapshot);
  const endChain = build42LegOptionChain(endSnapshot);

  return {
    data: {
      [String(Number(startTimestamp || 0))]: startChain.oiBySymbol,
      [String(Number(endTimestamp || 0))]: endChain.oiBySymbol
    }
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
    if (out.length >= INDEX_ANALYSIS_MAX_PROBE_CANDIDATES) {
      break;
    }
  }
  return out;
}

async function resolveSnapshotWithTradingFallback({
  symbol,
  requestTimestamp,
  timeoutMs = INDEX_ANALYSIS_SNAPSHOT_TIMEOUT_MS
}) {
  const candidates = buildProbeTimestampList(requestTimestamp);
  let lastError = null;
  const attemptedTimestamps = [];
  const startedAt = Date.now();

  for (const candidateTs of candidates) {
    if ((Date.now() - startedAt) >= INDEX_ANALYSIS_MAX_TOTAL_RESOLVE_MS) {
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

  const error = lastError || new Error("No option chain data found for requested timestamps and fallback window");
  error.attemptedTimestamps = attemptedTimestamps;
  throw error;
}

async function serveIndexAnalysis({
  symbol,
  expiry = "",
  startTimestamp,
  endTimestamp
}) {
  const normalizedExpiry = normalizeExpiry(expiry);
  const cacheKey = `${String(symbol || "NIFTY").toUpperCase()}:${normalizedExpiry || "auto"}:${startTimestamp}:${endTimestamp}`;
  const now = Date.now();
  const cached = indexAnalysisCache.get(cacheKey);
  if (cached && cached.expiresAt > now && hasNonEmptyIndexAnalysisPayload(cached.payload)) {
    return cached.payload;
  }

  if (indexAnalysisInflight.has(cacheKey)) {
    return indexAnalysisInflight.get(cacheKey);
  }

  const promise = (async () => {
    let startResolved;
    let endResolved;
    let startError = null;
    let endError = null;

    if (startTimestamp === endTimestamp) {
      const resolved = await resolveSnapshotWithTradingFallback({
        symbol,
        requestTimestamp: endTimestamp,
        timeoutMs: INDEX_ANALYSIS_SNAPSHOT_TIMEOUT_MS
      });
      startResolved = resolved;
      endResolved = resolved;
    } else {
      const [startResult, endResult] = await Promise.allSettled([
        resolveSnapshotWithTradingFallback({
          symbol,
          requestTimestamp: startTimestamp,
          timeoutMs: INDEX_ANALYSIS_SNAPSHOT_TIMEOUT_MS
        }),
        resolveSnapshotWithTradingFallback({
          symbol,
          requestTimestamp: endTimestamp,
          timeoutMs: INDEX_ANALYSIS_SNAPSHOT_TIMEOUT_MS
        })
      ]);
      if (startResult.status === "fulfilled") {
        startResolved = startResult.value;
      } else {
        startError = startResult.reason;
      }
      if (endResult.status === "fulfilled") {
        endResolved = endResult.value;
      } else {
        endError = endResult.reason;
      }

      if (!startResolved && endResolved) {
        startResolved = {
          ...endResolved,
          fallbackApplied: true
        };
      }
      if (!endResolved && startResolved) {
        endResolved = {
          ...startResolved,
          fallbackApplied: true
        };
      }
    }

    if (!startResolved || !endResolved) {
      const noDataError = startError || endError || new Error("No option chain data found for requested timestamps and fallback window");
      noDataError.attemptedTimestamps = [
        ...(Array.isArray(startError?.attemptedTimestamps) ? startError.attemptedTimestamps : []),
        ...(Array.isArray(endError?.attemptedTimestamps) ? endError.attemptedTimestamps : [])
      ];
      throw noDataError;
    }

    const payloadBase = buildPayload({
      startTimestamp,
      endTimestamp,
      startSnapshot: startResolved.snapshot,
      endSnapshot: endResolved.snapshot
    });
    if (!hasNonEmptyIndexAnalysisPayload(payloadBase)) {
      const noDataError = new Error("Resolved snapshots have no option chain data");
      noDataError.attemptedTimestamps = [
        ...(startResolved?.attemptedTimestamps || []),
        ...(endResolved?.attemptedTimestamps || [])
      ];
      throw noDataError;
    }
    const payload = payloadBase;

    indexAnalysisCache.set(cacheKey, {
      payload,
      expiresAt: Date.now() + INDEX_ANALYSIS_CACHE_TTL_MS
    });
    if (indexAnalysisCache.size > 48) {
      const firstKey = indexAnalysisCache.keys().next().value;
      indexAnalysisCache.delete(firstKey);
    }

    return payload;
  })().finally(() => {
    indexAnalysisInflight.delete(cacheKey);
  });

  indexAnalysisInflight.set(cacheKey, promise);
  return promise;
}

function validateRangeOrError(startTimestamp, endTimestamp) {
  if (!startTimestamp || !endTimestamp) {
    return "startTimestamp and endTimestamp are required";
  }
  if (endTimestamp < startTimestamp) {
    return "endTimestamp must be greater than or equal to startTimestamp";
  }
  return "";
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
  const { start, end, hasStart, hasEnd } = parseQueryTimestamps(params);
  const closedCutoff = getClosedMinuteCutoffIST();
  const startTimestamp = start || closedCutoff;
  const endTimestamp = end || startTimestamp;

  logIndexAnalysis("request:get", {
    path: request.nextUrl.pathname,
    symbol: rawSymbol,
    normalizedSymbol: symbol || null,
    expiry: expiry || null,
    startTimestamp,
    endTimestamp
  });

  if (!symbol) {
    return NextResponse.json({ error: `unsupported symbol: ${rawSymbol}` }, { status: 400 });
  }
  if (!hasStart || !hasEnd) {
    return NextResponse.json(
      { error: "startTimestamp and endTimestamp query params are required" },
      { status: 400 }
    );
  }
  const rangeError = validateRangeOrError(startTimestamp, endTimestamp);
  if (rangeError) {
    return NextResponse.json({ error: rangeError }, { status: 400 });
  }

  try {
    const payload = await withTimeout(serveIndexAnalysis({
      symbol,
      expiry,
      startTimestamp,
      endTimestamp
    }), INDEX_ANALYSIS_REQUEST_BUDGET_MS, "index_analysis request timeout");
    const dataEntries = payload?.data && typeof payload.data === "object" ? Object.values(payload.data) : [];
    const ts1Data = dataEntries[0] && typeof dataEntries[0] === "object" ? dataEntries[0] : {};
    const ts2Data = dataEntries[1] && typeof dataEntries[1] === "object" ? dataEntries[1] : {};
    logIndexAnalysis("success:get", {
      symbol,
      expiry: expiry || null,
      startTimestamp,
      endTimestamp,
      ts1LegCount: Object.keys(ts1Data).length,
      ts2LegCount: Object.keys(ts2Data).length,
      durationMs: Date.now() - startedAt
    });
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    const stale = findRecentIndexAnalysisCacheBySymbol(symbol, expiry);
    if (stale) {
      logIndexAnalysis("stale_cache_hit:get", {
        symbol,
        expiry: expiry || null,
        startTimestamp,
        endTimestamp
      });
      return NextResponse.json(stale, { status: 200 });
    }
    const status = classifyIndexAnalysisError(error);
    const message = error?.message || "Failed to fetch index analysis";
    logIndexAnalysis("error:get", {
      status,
      symbol,
      expiry: expiry || null,
      startTimestamp,
      endTimestamp,
      durationMs: Date.now() - startedAt,
      attemptedTimestamps: Array.isArray(error?.attemptedTimestamps) ? error.attemptedTimestamps : []
    });
    if (status >= 500) {
      return NextResponse.json(
        buildIndexAnalysisFallbackPayload({
          startTimestamp,
          endTimestamp
        }),
        { status: 200 }
      );
    }
    const errorPayload = buildIndexAnalysisErrorPayload({
      symbol,
      expiry,
      startTimestamp,
      endTimestamp,
      status,
      message,
      attemptedTimestamps: Array.isArray(error?.attemptedTimestamps) ? error.attemptedTimestamps : [],
      latestClosedTimestamp: closedCutoff
    });
    return NextResponse.json(errorPayload, { status });
  }
}

export async function POST(request) {
  const startedAt = Date.now();
  const auth = await requireMarketAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body = null;
  try {
    body = await request.json();
  } catch (_) {
    body = null;
  }

  const rawSymbol = String(body?.symbol || "NIFTY");
  const symbol = normalizeOptionSymbol(rawSymbol);
  const expiry = normalizeExpiry(body?.expiry);
  const { start, end, hasStart, hasEnd } = parseBodyTimestamps(body);
  const closedCutoff = getClosedMinuteCutoffIST();
  const startTimestamp = start || closedCutoff;
  const endTimestamp = end || startTimestamp;

  logIndexAnalysis("request:post", {
    path: request.nextUrl.pathname,
    symbol: rawSymbol,
    normalizedSymbol: symbol || null,
    expiry: expiry || null,
    startTimestamp,
    endTimestamp
  });

  if (!symbol) {
    return NextResponse.json({ error: `unsupported symbol: ${rawSymbol}` }, { status: 400 });
  }
  if (!hasStart || !hasEnd) {
    return NextResponse.json(
      { error: "startTimestamp and endTimestamp are required" },
      { status: 400 }
    );
  }
  const rangeError = validateRangeOrError(startTimestamp, endTimestamp);
  if (rangeError) {
    return NextResponse.json({ error: rangeError }, { status: 400 });
  }

  try {
    const payload = await withTimeout(serveIndexAnalysis({
      symbol,
      expiry,
      startTimestamp,
      endTimestamp
    }), INDEX_ANALYSIS_REQUEST_BUDGET_MS, "index_analysis request timeout");
    const dataEntries = payload?.data && typeof payload.data === "object" ? Object.values(payload.data) : [];
    const ts1Data = dataEntries[0] && typeof dataEntries[0] === "object" ? dataEntries[0] : {};
    const ts2Data = dataEntries[1] && typeof dataEntries[1] === "object" ? dataEntries[1] : {};
    logIndexAnalysis("success:post", {
      symbol,
      expiry: expiry || null,
      startTimestamp,
      endTimestamp,
      ts1LegCount: Object.keys(ts1Data).length,
      ts2LegCount: Object.keys(ts2Data).length,
      durationMs: Date.now() - startedAt
    });
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    const stale = findRecentIndexAnalysisCacheBySymbol(symbol, expiry);
    if (stale) {
      logIndexAnalysis("stale_cache_hit:post", {
        symbol,
        expiry: expiry || null,
        startTimestamp,
        endTimestamp
      });
      return NextResponse.json(stale, { status: 200 });
    }
    const status = classifyIndexAnalysisError(error);
    const message = error?.message || "Failed to fetch index analysis";
    logIndexAnalysis("error:post", {
      status,
      symbol,
      expiry: expiry || null,
      startTimestamp,
      endTimestamp,
      durationMs: Date.now() - startedAt,
      attemptedTimestamps: Array.isArray(error?.attemptedTimestamps) ? error.attemptedTimestamps : []
    });
    if (status >= 500) {
      return NextResponse.json(
        buildIndexAnalysisFallbackPayload({
          startTimestamp,
          endTimestamp
        }),
        { status: 200 }
      );
    }
    const errorPayload = buildIndexAnalysisErrorPayload({
      symbol,
      expiry,
      startTimestamp,
      endTimestamp,
      status,
      message,
      attemptedTimestamps: Array.isArray(error?.attemptedTimestamps) ? error.attemptedTimestamps : [],
      latestClosedTimestamp: closedCutoff
    });
    return NextResponse.json(errorPayload, { status });
  }
}
