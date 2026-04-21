import { NextResponse } from "next/server";
import { fetchOptionRange, fetchOptionSnapshot } from "@/lib/api";
import { requireMarketAccess } from "@/lib/routeAccess";

const OPTION_RANGE_CACHE_TTL_MS = 20 * 1000;
const OPTION_RANGE_STALE_MAX_AGE_MS = 2 * 60 * 1000;
const OPTION_RANGE_TIMEOUT_MS = 7000;
const OPTION_RANGE_LEAN_TIMEOUT_MS = 12000;
const OPTION_RANGE_LEAN_FAST_BUDGET_MS = 950;
const OPTION_RANGE_SNAPSHOT_CACHE_TTL_MS = 15 * 1000;
const OPTION_RANGE_SNAPSHOT_TIMEOUT_MS = 7000;
const OPTION_RANGE_SNAPSHOT_NEAREST_MAX_DISTANCE_SEC = 5 * 60;
const optionRangeCache = new Map();
const optionRangeInflight = new Map();
const optionSnapshotCache = new Map();
const optionSnapshotInflight = new Map();
const SNAPSHOT_SUMMARY_CACHE_SYMBOL = Symbol("optionSnapshotSummary");

function logOptionRangeRequest(stage, request, details = {}) {
  try {
    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    console.info(`[api/options/range] ${stage}`, {
      method: request.method,
      path: request.nextUrl.pathname,
      params,
      ...details
    });
  } catch {
    // no-op
  }
}

function logOptionRangePost(stage, details = {}) {
  try {
    console.info("[api/options/range] " + stage, details);
  } catch {
    // no-op
  }
}

function classifyOptionRangeError(error) {
  const statusFromError = Number(error?.status);
  if (Number.isFinite(statusFromError) && statusFromError > 0) {
    return statusFromError;
  }
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("timeout")) {
    return 504;
  }
  if (message.includes("no candles") || message.includes("not found") || message.includes("unsupported option symbol")) {
    return 404;
  }
  if (message.includes("required") || message.includes("invalid") || message.includes("unsupported")) {
    return 400;
  }
  return 500;
}

function normalizeTimestamp(value) {
  let numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  if (numeric > 1_000_000_000_000) {
    numeric = Math.floor(numeric / 1000);
  }
  return Math.floor(numeric / 60) * 60;
}

function asFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parseFromTo(searchParams) {
  const from = clampToClosedMinute(normalizeTimestamp(searchParams.get("from")));
  const to = clampToClosedMinute(normalizeTimestamp(searchParams.get("to")));
  return { from, to };
}

function getClosedMinuteCutoffIST() {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const currentMinute = Math.floor(istNow.getTime() / 1000 / 60) * 60;
  return currentMinute - 60;
}

function clampToClosedMinute(timestamp) {
  const ts = normalizeTimestamp(timestamp);
  if (!ts) {
    return null;
  }
  const closedCutoff = getClosedMinuteCutoffIST();
  if (Number.isFinite(closedCutoff) && ts > closedCutoff) {
    return closedCutoff;
  }
  return ts;
}

function parseLeanFlag(value) {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function trimOptionSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }
  return {
    timestamp: normalizeTimestamp(snapshot.timestamp) || 0,
    symbol: String(snapshot.symbol || ""),
    underlying: Number.isFinite(Number(snapshot.underlying)) ? Number(snapshot.underlying) : 0,
    source: String(snapshot.source || ""),
    interval: String(snapshot.interval || "")
  };
}

function snapshotStrikeRows(snapshot) {
  return Array.isArray(snapshot?.strikes) ? snapshot.strikes : [];
}

function summarizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return {
      callOiTotal: 0,
      putOiTotal: 0,
      totalOi: 0,
      pcr: 0,
      highestCallOi: 0,
      highestCallStrike: 0,
      highestPutOi: 0,
      highestPutStrike: 0
    };
  }

  if (snapshot[SNAPSHOT_SUMMARY_CACHE_SYMBOL]) {
    return snapshot[SNAPSHOT_SUMMARY_CACHE_SYMBOL];
  }

  let callOiTotal = 0;
  let putOiTotal = 0;
  let highestCallOi = 0;
  let highestCallStrike = 0;
  let highestPutOi = 0;
  let highestPutStrike = 0;

  for (const strike of snapshotStrikeRows(snapshot)) {
    const strikePrice = asFiniteNumber(strike?.strike, 0);
    const currentCallOi = asFiniteNumber(strike?.call?.oi, 0);
    const currentPutOi = asFiniteNumber(strike?.put?.oi, 0);
    callOiTotal += currentCallOi;
    putOiTotal += currentPutOi;
    if (currentCallOi > highestCallOi) {
      highestCallOi = currentCallOi;
      highestCallStrike = strikePrice;
    }
    if (currentPutOi > highestPutOi) {
      highestPutOi = currentPutOi;
      highestPutStrike = strikePrice;
    }
  }

  const totalOi = callOiTotal + putOiTotal;
  const pcr = callOiTotal > 0 ? (putOiTotal / callOiTotal) : 0;
  const summary = {
    callOiTotal,
    putOiTotal,
    totalOi,
    pcr,
    highestCallOi,
    highestCallStrike,
    highestPutOi,
    highestPutStrike
  };

  try {
    Object.defineProperty(snapshot, SNAPSHOT_SUMMARY_CACHE_SYMBOL, {
      value: summary,
      enumerable: false,
      configurable: true
    });
  } catch {
    snapshot[SNAPSHOT_SUMMARY_CACHE_SYMBOL] = summary;
  }
  return summary;
}

function sumSnapshotOi(snapshot) {
  const summary = summarizeSnapshot(snapshot);
  return {
    callOiTotal: summary.callOiTotal,
    putOiTotal: summary.putOiTotal,
    totalOi: summary.totalOi,
    pcr: summary.pcr
  };
}

function buildSelectedDiffStats(startSnapshot, endSnapshot) {
  const startTotals = summarizeSnapshot(startSnapshot);
  const endTotals = summarizeSnapshot(endSnapshot);
  const callOiTotal = asFiniteNumber(endTotals.callOiTotal, 0) - asFiniteNumber(startTotals.callOiTotal, 0);
  const putOiTotal = asFiniteNumber(endTotals.putOiTotal, 0) - asFiniteNumber(startTotals.putOiTotal, 0);
  const totalOi = callOiTotal + putOiTotal;
  const pcr = callOiTotal !== 0 ? (putOiTotal / callOiTotal) : 0;
  return {
    snapshotCount: 2,
    callOiTotal: Math.round(callOiTotal),
    putOiTotal: Math.round(putOiTotal),
    totalOi: Math.round(totalOi),
    pcr: Number.isFinite(pcr) ? Number(pcr.toFixed(2)) : 0,
    commonStrikeCount: 0,
    approximate: true
  };
}

function buildHighestOi(snapshot) {
  const summary = summarizeSnapshot(snapshot);
  const callStrike = asFiniteNumber(summary.highestCallStrike, 0);
  const callOI = asFiniteNumber(summary.highestCallOi, 0);
  const putStrike = asFiniteNumber(summary.highestPutStrike, 0);
  const putOI = asFiniteNumber(summary.highestPutOi, 0);
  const resolvedTimestamp = normalizeTimestamp(snapshot?.timestamp) || 0;
  return {
    callStrike,
    callOI,
    callTimestamp: resolvedTimestamp,
    putStrike,
    putOI,
    putTimestamp: resolvedTimestamp
  };
}

function buildLeanRangeFromSnapshots({ symbol, from, to, startSnapshot, endSnapshot }) {
  const startTs = normalizeTimestamp(startSnapshot?.timestamp) || from;
  const endTs = normalizeTimestamp(endSnapshot?.timestamp) || to;

  const selectedStats = buildSelectedDiffStats(startSnapshot, endSnapshot);
  const endTotals = sumSnapshotOi(endSnapshot);
  const startTotals = sumSnapshotOi(startSnapshot);
  const net = endTotals.totalOi - startTotals.totalOi;
  const netPct = startTotals.totalOi !== 0 ? (net / startTotals.totalOi) * 100 : 0;

  return {
    symbol: String(symbol || "NIFTY"),
    source: String(endSnapshot?.source || startSnapshot?.source || "proxy:snapshot-composed"),
    interval: String(endSnapshot?.interval || startSnapshot?.interval || "1m"),
    startTimestamp: from,
    endTimestamp: to,
    ts1: {
      requestTimestamp: from,
      resolvedTimestamp: startTs,
      exactMatch: startTs === from,
      snapshot: trimOptionSnapshot(startSnapshot)
    },
    ts2: {
      requestTimestamp: to,
      resolvedTimestamp: endTs,
      exactMatch: endTs === to,
      snapshot: trimOptionSnapshot(endSnapshot)
    },
    ohlc: {
      open: Number(asFiniteNumber(startSnapshot?.underlying, 0).toFixed(2)),
      high: Number(Math.max(asFiniteNumber(startSnapshot?.underlying, 0), asFiniteNumber(endSnapshot?.underlying, 0)).toFixed(2)),
      low: Number(Math.min(asFiniteNumber(startSnapshot?.underlying, 0), asFiniteNumber(endSnapshot?.underlying, 0)).toFixed(2)),
      close: Number(asFiniteNumber(endSnapshot?.underlying, 0).toFixed(2))
    },
    selected: {
      snapshotCount: selectedStats.snapshotCount,
      callOiTotal: selectedStats.callOiTotal,
      putOiTotal: selectedStats.putOiTotal,
      totalOi: selectedStats.totalOi,
      pcr: selectedStats.pcr
    },
    session: {
      snapshotCount: 1,
      callOiTotal: Math.round(endTotals.callOiTotal),
      putOiTotal: Math.round(endTotals.putOiTotal),
      totalOi: Math.round(endTotals.totalOi),
      pcr: Number.isFinite(endTotals.pcr) ? Number(endTotals.pcr.toFixed(4)) : 0,
      sessionStartTimestamp: from,
      sessionLatestTimestamp: endTs
    },
    netOiChange: {
      totalTs1: Number(startTotals.totalOi.toFixed(1)),
      totalTs2: Number(endTotals.totalOi.toFixed(1)),
      net: Number(net.toFixed(1)),
      pct: Number.isFinite(netPct) ? Number(netPct.toFixed(2)) : 0
    },
    highestOI: buildHighestOi(endSnapshot),
    coverage: {
      requested: 2,
      resolved: 2,
      selectedRequested: 2,
      selectedResolved: 2,
      commonStrikeCount: selectedStats.commonStrikeCount
    },
    startSnapshot: trimOptionSnapshot(startSnapshot),
    endSnapshot: trimOptionSnapshot(endSnapshot),
    latestSnapshot: trimOptionSnapshot(endSnapshot)
  };
}

function buildEmptyLeanRangePayload({ symbol, from, to, errorMessage = "" }) {
  const normalizedSymbol = String(symbol || "NIFTY");
  return {
    symbol: normalizedSymbol,
    source: "proxy:range-empty-fallback",
    interval: "1m",
    startTimestamp: normalizeTimestamp(from) || 0,
    endTimestamp: normalizeTimestamp(to) || 0,
    ohlc: {
      open: 0,
      high: 0,
      low: 0,
      close: 0
    },
    ts1: {
      requestTimestamp: normalizeTimestamp(from) || 0,
      resolvedTimestamp: 0,
      exactMatch: false,
      snapshot: null
    },
    ts2: {
      requestTimestamp: normalizeTimestamp(to) || 0,
      resolvedTimestamp: 0,
      exactMatch: false,
      snapshot: null
    },
    selected: {
      snapshotCount: 0,
      callOiTotal: 0,
      putOiTotal: 0,
      totalOi: 0,
      pcr: 0
    },
    session: {
      snapshotCount: 0,
      callOiTotal: 0,
      putOiTotal: 0,
      totalOi: 0,
      pcr: 0,
      sessionStartTimestamp: normalizeTimestamp(from) || 0,
      sessionLatestTimestamp: 0
    },
    netOiChange: {
      totalTs1: 0,
      totalTs2: 0,
      net: 0,
      pct: 0
    },
    highestOI: {
      callStrike: 0,
      callOI: 0,
      callTimestamp: 0,
      putStrike: 0,
      putOI: 0,
      putTimestamp: 0
    },
    coverage: {
      requested: 2,
      resolved: 0,
      selectedRequested: 2,
      selectedResolved: 0,
      commonStrikeCount: 0
    },
    startSnapshot: null,
    endSnapshot: null,
    latestSnapshot: null,
    partial: true,
    stale: true,
    warning: errorMessage ? `Option range fallback: ${errorMessage}` : "Option range fallback: snapshots unavailable"
  };
}

function toLeanOptionRangePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  return {
    symbol: String(payload.symbol || ""),
    source: String(payload.source || ""),
    interval: String(payload.interval || ""),
    startTimestamp: normalizeTimestamp(payload.startTimestamp) || 0,
    endTimestamp: normalizeTimestamp(payload.endTimestamp) || 0,
    ts1: payload.ts1 || null,
    ts2: payload.ts2 || null,
    selected: payload.selected || null,
    session: payload.session || null,
    netOiChange: payload.netOiChange || null,
    highestOI: payload.highestOI || null,
    startSnapshot: trimOptionSnapshot(payload.startSnapshot),
    endSnapshot: trimOptionSnapshot(payload.endSnapshot),
    latestSnapshot: trimOptionSnapshot(payload.latestSnapshot)
  };
}

function withTimeout(promise, timeoutMs) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("option range request timeout")), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function findNearestSnapshotCacheForRange(symbol, targetTs) {
  const normalizedSymbol = String(symbol || "").toUpperCase();
  const target = normalizeTimestamp(targetTs);
  if (!normalizedSymbol || !target) {
    return null;
  }
  const now = Date.now();
  let best = null;

  for (const [key, entry] of optionSnapshotCache.entries()) {
    const separator = String(key).indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const keySymbol = String(key).slice(0, separator).toUpperCase();
    if (keySymbol !== normalizedSymbol) {
      continue;
    }
    const tsValue = normalizeTimestamp(String(key).slice(separator + 1));
    if (!tsValue) {
      continue;
    }
    const createdAt = entry.expiresAt - OPTION_RANGE_SNAPSHOT_CACHE_TTL_MS;
    if ((now - createdAt) > OPTION_RANGE_STALE_MAX_AGE_MS) {
      continue;
    }
    const distance = Math.abs(tsValue - target);
    if (distance > OPTION_RANGE_SNAPSHOT_NEAREST_MAX_DISTANCE_SEC) {
      continue;
    }
    if (!best || distance < best.distance || (distance === best.distance && createdAt > best.createdAt)) {
      best = {
        payload: entry.payload,
        distance,
        createdAt
      };
    }
  }

  return best ? { ...(best.payload || {}), stale: true } : null;
}

function findRecentSnapshotCacheForSymbol(symbol) {
  const normalizedSymbol = String(symbol || "").toUpperCase();
  if (!normalizedSymbol) {
    return null;
  }
  const now = Date.now();
  let best = null;

  for (const [key, entry] of optionSnapshotCache.entries()) {
    const separator = String(key).indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const keySymbol = String(key).slice(0, separator).toUpperCase();
    if (keySymbol !== normalizedSymbol) {
      continue;
    }
    const createdAt = entry.expiresAt - OPTION_RANGE_SNAPSHOT_CACHE_TTL_MS;
    if ((now - createdAt) > OPTION_RANGE_STALE_MAX_AGE_MS) {
      continue;
    }
    if (!best || createdAt > best.createdAt) {
      best = {
        payload: entry.payload,
        createdAt
      };
    }
  }

  return best ? { ...(best.payload || {}), stale: true } : null;
}

async function fetchOptionSnapshotCachedForRange(symbol, ts) {
  const normalizedSymbol = String(symbol || "NIFTY").toUpperCase();
  const normalizedTs = clampToClosedMinute(ts);
  if (!normalizedTs) {
    throw new Error("invalid option snapshot timestamp");
  }

  const cacheKey = `${normalizedSymbol}:${normalizedTs}`;
  const now = Date.now();
  const cached = optionSnapshotCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.payload;
  }

  const nearestCached = findNearestSnapshotCacheForRange(normalizedSymbol, normalizedTs);
  if (nearestCached) {
    return nearestCached;
  }

  if (optionSnapshotInflight.has(cacheKey)) {
    return optionSnapshotInflight.get(cacheKey);
  }

  const promise = withTimeout(
    fetchOptionSnapshot({ symbol: normalizedSymbol, ts: normalizedTs }),
    OPTION_RANGE_SNAPSHOT_TIMEOUT_MS
  ).then((payload) => {
    optionSnapshotCache.set(cacheKey, {
      payload,
      expiresAt: Date.now() + OPTION_RANGE_SNAPSHOT_CACHE_TTL_MS
    });
    if (optionSnapshotCache.size > 96) {
      const firstKey = optionSnapshotCache.keys().next().value;
      optionSnapshotCache.delete(firstKey);
    }
    return payload;
  }).catch((error) => {
    const stale = optionSnapshotCache.get(cacheKey);
    if (stale && (Date.now() - (stale.expiresAt - OPTION_RANGE_SNAPSHOT_CACHE_TTL_MS)) <= OPTION_RANGE_STALE_MAX_AGE_MS) {
      return {
        ...(stale.payload || {}),
        stale: true
      };
    }
    const nearest = findNearestSnapshotCacheForRange(normalizedSymbol, normalizedTs);
    if (nearest) {
      return nearest;
    }
    const recentBySymbol = findRecentSnapshotCacheForSymbol(normalizedSymbol);
    if (recentBySymbol) {
      return recentBySymbol;
    }
    throw error;
  }).finally(() => {
    optionSnapshotInflight.delete(cacheKey);
  });

  optionSnapshotInflight.set(cacheKey, promise);
  return promise;
}

function getCachedOptionSnapshotForRange(symbol, ts) {
  const normalizedSymbol = String(symbol || "NIFTY").toUpperCase();
  const normalizedTs = clampToClosedMinute(ts);
  if (!normalizedTs) {
    return null;
  }
  const cacheKey = `${normalizedSymbol}:${normalizedTs}`;
  const now = Date.now();
  const cached = optionSnapshotCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.payload;
  }
  const nearestCached = findNearestSnapshotCacheForRange(normalizedSymbol, normalizedTs);
  if (nearestCached) {
    return nearestCached;
  }
  const stale = optionSnapshotCache.get(cacheKey);
  if (stale && (now - (stale.expiresAt - OPTION_RANGE_SNAPSHOT_CACHE_TTL_MS)) <= OPTION_RANGE_STALE_MAX_AGE_MS) {
    return { ...(stale.payload || {}), stale: true };
  }
  const recent = findRecentSnapshotCacheForSymbol(normalizedSymbol);
  if (recent) {
    return recent;
  }
  return null;
}

async function buildLeanRangePayloadViaSnapshots(symbol, from, to) {
  const normalizedFrom = clampToClosedMinute(from);
  const normalizedTo = clampToClosedMinute(to);
  if (!normalizedFrom || !normalizedTo) {
    throw new Error("invalid range timestamps");
  }

  let startSnapshot = null;
  let endSnapshot = null;
  let startError = null;
  let endError = null;

  if (normalizedFrom === normalizedTo) {
    try {
      const sameSnapshot = await fetchOptionSnapshotCachedForRange(symbol, normalizedTo);
      startSnapshot = sameSnapshot;
      endSnapshot = sameSnapshot;
    } catch (error) {
      startError = error;
      endError = error;
    }
  } else {
    const [startResult, endResult] = await Promise.allSettled([
      fetchOptionSnapshotCachedForRange(symbol, normalizedFrom),
      fetchOptionSnapshotCachedForRange(symbol, normalizedTo)
    ]);
    if (startResult.status === "fulfilled") {
      startSnapshot = startResult.value;
    } else {
      startError = startResult.reason;
    }
    if (endResult.status === "fulfilled") {
      endSnapshot = endResult.value;
    } else {
      endError = endResult.reason;
    }
  }

  if (!startSnapshot && endSnapshot) {
    startSnapshot = endSnapshot;
  } else if (!endSnapshot && startSnapshot) {
    endSnapshot = startSnapshot;
  }
  if (!startSnapshot || !endSnapshot) {
    throw (startError || endError || new Error("option snapshots unavailable"));
  }

  return buildLeanRangeFromSnapshots({
    symbol,
    from: normalizedFrom,
    to: normalizedTo,
    startSnapshot,
    endSnapshot
  });
}

function buildLeanRangeFromCacheOnly(symbol, from, to) {
  const normalizedFrom = clampToClosedMinute(from);
  const normalizedTo = clampToClosedMinute(to);
  if (!normalizedFrom || !normalizedTo) {
    return null;
  }

  const startSnapshot = getCachedOptionSnapshotForRange(symbol, normalizedFrom);
  const endSnapshot = normalizedFrom === normalizedTo
    ? startSnapshot
    : getCachedOptionSnapshotForRange(symbol, normalizedTo);

  if (!startSnapshot && !endSnapshot) {
    return null;
  }

  return buildLeanRangeFromSnapshots({
    symbol,
    from: normalizedFrom,
    to: normalizedTo,
    startSnapshot: startSnapshot || endSnapshot,
    endSnapshot: endSnapshot || startSnapshot
  });
}

function findRecentRangeCacheForSymbol(symbol, lean) {
  const normalizedSymbol = String(symbol || "").toUpperCase();
  const modeTag = lean ? "lean" : "full";
  const now = Date.now();
  let best = null;

  for (const [key, entry] of optionRangeCache.entries()) {
    const parts = String(key).split(":");
    if (parts.length < 4) {
      continue;
    }
    if (String(parts[0] || "").toUpperCase() !== normalizedSymbol) {
      continue;
    }
    if (String(parts[3] || "") !== modeTag) {
      continue;
    }

    const createdAt = entry.expiresAt - OPTION_RANGE_CACHE_TTL_MS;
    if ((now - createdAt) > OPTION_RANGE_STALE_MAX_AGE_MS) {
      continue;
    }
    if (!best || createdAt > best.createdAt) {
      best = {
        payload: entry.payload,
        createdAt
      };
    }
  }

  return best ? { ...(best.payload || {}), stale: true } : null;
}

async function serveOptionRange({ symbol, from, to, lean }) {
  const cacheKey = `${String(symbol).toUpperCase()}:${from}:${to}:${lean ? "lean" : "full"}`;
  const now = Date.now();
  const cached = optionRangeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.payload;
  }

  if (optionRangeInflight.has(cacheKey)) {
    return optionRangeInflight.get(cacheKey);
  }

  const promise = withTimeout((async () => {
    let payload;
    if (lean) {
      payload = await buildLeanRangePayloadViaSnapshots(symbol, from, to);
    } else {
      const rangePayload = await fetchOptionRange({ symbol, from, to });
      payload = rangePayload;
    }
    const finalPayload = payload;
    optionRangeCache.set(cacheKey, {
      payload: finalPayload,
      expiresAt: Date.now() + OPTION_RANGE_CACHE_TTL_MS
    });
    if (optionRangeCache.size > 24) {
      const firstKey = optionRangeCache.keys().next().value;
      optionRangeCache.delete(firstKey);
    }
    return finalPayload;
  })(), lean ? OPTION_RANGE_LEAN_TIMEOUT_MS : OPTION_RANGE_TIMEOUT_MS).finally(() => {
    optionRangeInflight.delete(cacheKey);
  });

  optionRangeInflight.set(cacheKey, promise);
  try {
    if (lean) {
      try {
        return await withTimeout(promise, OPTION_RANGE_LEAN_FAST_BUDGET_MS);
      } catch (fastPathError) {
        const cachedDerived = buildLeanRangeFromCacheOnly(symbol, from, to);
        if (cachedDerived) {
          optionRangeCache.set(cacheKey, {
            payload: cachedDerived,
            expiresAt: Date.now() + OPTION_RANGE_CACHE_TTL_MS
          });
          return {
            ...cachedDerived,
            stale: true,
            partial: true,
            warning: "Fast range response served from cached snapshots while fresh data is warming"
          };
        }

        const stale = optionRangeCache.get(cacheKey);
        if (stale && (Date.now() - (stale.expiresAt - OPTION_RANGE_CACHE_TTL_MS)) <= OPTION_RANGE_STALE_MAX_AGE_MS) {
          return {
            ...(stale.payload || {}),
            stale: true,
            partial: true
          };
        }
        const recentBySymbol = findRecentRangeCacheForSymbol(symbol, true);
        if (recentBySymbol) {
          return {
            ...recentBySymbol,
            partial: true,
            warning: recentBySymbol.warning || "Fast range response served from recent cached range"
          };
        }

        return buildEmptyLeanRangePayload({
          symbol,
          from,
          to,
          errorMessage: `warming snapshots (${String(fastPathError?.message || "timeout")})`
        });
      }
    }
    return await promise;
  } catch (error) {
    const stale = optionRangeCache.get(cacheKey);
    if (stale && (Date.now() - (stale.expiresAt - OPTION_RANGE_CACHE_TTL_MS)) <= OPTION_RANGE_STALE_MAX_AGE_MS) {
      return {
        ...(stale.payload || {}),
        stale: true
      };
    }
    const recentBySymbol = findRecentRangeCacheForSymbol(symbol, lean);
    if (recentBySymbol) {
      return recentBySymbol;
    }
    if (lean) {
      const fallbackPayload = buildEmptyLeanRangePayload({
        symbol,
        from,
        to,
        errorMessage: String(error?.message || "")
      });
      optionRangeCache.set(cacheKey, {
        payload: fallbackPayload,
        expiresAt: Date.now() + 10 * 1000
      });
      return fallbackPayload;
    }

    // For full range mode, avoid hard 504 by downgrading to a lean snapshot-composed payload.
    try {
      const leanFallback = await buildLeanRangePayloadViaSnapshots(symbol, from, to);
      return {
        ...leanFallback,
        partial: true,
        stale: true,
        warning: `full_range_fallback:${String(error?.message || "timeout")}`
      };
    } catch {
      const cachedDerived = buildLeanRangeFromCacheOnly(symbol, from, to);
      if (cachedDerived) {
        return {
          ...cachedDerived,
          partial: true,
          stale: true,
          warning: `full_range_fallback:${String(error?.message || "timeout")}`
        };
      }
    }

    throw error;
  }
}

export async function GET(request) {
  logOptionRangeRequest("request", request);
  const auth = await requireMarketAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const params = request.nextUrl.searchParams;
  const symbol = params.get("symbol") || "NIFTY";
  const { from, to } = parseFromTo(params);
  const lean = parseLeanFlag(params.get("lean"));

  if (!from || !to) {
    logOptionRangeRequest("bad_request", request, { reason: "missing from/to" });
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }
  if (to <= from) {
    logOptionRangeRequest("bad_request", request, { reason: "to<=from", from, to });
    return NextResponse.json({ error: "to must be greater than from" }, { status: 400 });
  }

  try {
    const payload = await serveOptionRange({ symbol, from, to, lean });
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    const status = classifyOptionRangeError(error);
    const message = error.message || "Failed to fetch option range";
    logOptionRangeRequest("error", request, { status, message, symbol, from, to, lean });
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}

export async function POST(request) {
  logOptionRangeRequest("request", request);
  const auth = await requireMarketAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let payload = null;
  try {
    payload = await request.json();
  } catch (_) {
    payload = null;
  }

  const symbol = String(payload?.symbol || "NIFTY");
  const from = clampToClosedMinute(payload?.startTimestamp ?? payload?.from);
  const to = clampToClosedMinute(payload?.endTimestamp ?? payload?.to);
  const lean = parseLeanFlag(payload?.lean);

  if (!from || !to) {
    logOptionRangePost("bad_request", { reason: "missing startTimestamp/endTimestamp", payload });
    return NextResponse.json({ error: "startTimestamp and endTimestamp are required" }, { status: 400 });
  }
  if (to <= from) {
    logOptionRangePost("bad_request", { reason: "to<=from", from, to, symbol, lean });
    return NextResponse.json({ error: "endTimestamp must be greater than startTimestamp" }, { status: 400 });
  }

  try {
    const rangePayload = await serveOptionRange({ symbol, from, to, lean });
    return NextResponse.json(rangePayload, { status: 200 });
  } catch (error) {
    const status = classifyOptionRangeError(error);
    const message = error.message || "Failed to fetch option range";
    logOptionRangePost("error", { status, message, symbol, from, to, lean });
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
