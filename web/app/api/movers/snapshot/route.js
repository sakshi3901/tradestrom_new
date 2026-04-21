import { NextResponse } from "next/server";
import { fetchContributionSeries, fetchMoversSnapshot } from "@/lib/api";
import { requireMarketAccess } from "@/lib/routeAccess";

const SNAPSHOT_CACHE_TTL_MS = 20 * 1000;
const SNAPSHOT_STALE_MAX_AGE_MS = 2 * 60 * 1000;
const SNAPSHOT_DB_FETCH_TIMEOUT_MS = 2200;
const SNAPSHOT_FALLBACK_FETCH_TIMEOUT_MS = 3200;
const snapshotCache = new Map();
const snapshotInflight = new Map();
const BANKNIFTY_CONSTITUENTS = new Set([
  "AUBANK",
  "AXISBANK",
  "BANDHANBNK",
  "BANKBARODA",
  "CANBK",
  "FEDERALBNK",
  "HDFCBANK",
  "ICICIBANK",
  "IDFCFIRSTB",
  "INDUSINDBK",
  "KOTAKBANK",
  "PNB",
  "SBIN"
]);

function logSnapshotRequest(stage, request, details = {}) {
  try {
    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    console.info(`[api/movers/snapshot] ${stage}`, {
      method: request.method,
      path: request.nextUrl.pathname,
      params,
      ...details
    });
  } catch {
    // no-op
  }
}

function classifySnapshotError(error) {
  const statusFromError = Number(error?.status);
  if (Number.isFinite(statusFromError) && statusFromError > 0) {
    return statusFromError;
  }
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("timeout") || message.includes("aborted")) {
    return 504;
  }
  if (message.includes("no movers snapshot found") || message.includes("not found")) {
    return 404;
  }
  if (message.includes("required") || message.includes("invalid") || message.includes("unsupported")) {
    return 400;
  }
  return 500;
}

function asFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeTimestampToMinute(value) {
  let numeric = asFiniteNumber(value, NaN);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  if (numeric > 1_000_000_000_000) {
    numeric = Math.floor(numeric / 1000);
  }
  return Math.floor(numeric / 60) * 60;
}

function parsePositiveInt(value, fallback, max = 500) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(numeric), max);
}

function parseBoolFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

async function fetchMoversSnapshotWithTimeout({
  index,
  ts,
  limit,
  dbOnly,
  timeoutMs
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await fetchMoversSnapshot({
      index,
      ts,
      limit,
      dbOnly,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("snapshot request timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchContributionSeriesWithTimeout({
  symbol,
  interval,
  at,
  onlySelected,
  timeoutMs
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await fetchContributionSeries({
      symbol,
      interval,
      at,
      onlySelected,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("snapshot request timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function getAllowedConstituentSetFromContributionSeries(payload, requestedIndex) {
  const rows = Array.isArray(payload?.constituents) ? payload.constituents : [];
  const parsed = new Set();

  for (const row of rows) {
    const symbol = String(row?.symbol || "").trim().toUpperCase();
    if (symbol) {
      parsed.add(symbol);
    }
  }

  if (parsed.size > 0) {
    return parsed;
  }

  const normalizedIndex = String(requestedIndex || "").trim().toUpperCase();
  if (normalizedIndex === "BANKNIFTY" || normalizedIndex === "NIFTYBANK" || normalizedIndex === "NIFTY BANK") {
    return BANKNIFTY_CONSTITUENTS;
  }

  return null;
}

function findRecentSnapshotCacheForIndex({ index, interval, limit }) {
  const normalizedIndex = String(index || "").toUpperCase();
  const normalizedInterval = String(interval || "1m");
  const normalizedLimit = parsePositiveInt(limit, 20, 500);
  const nowMs = Date.now();
  let best = null;

  for (const [key, entry] of snapshotCache.entries()) {
    const [entryIndex = "", entryInterval = "", _entryTs = "", entryLimit = ""] = String(key).split(":");
    if (String(entryIndex).toUpperCase() !== normalizedIndex) {
      continue;
    }
    if (String(entryInterval) !== normalizedInterval) {
      continue;
    }
    if (parsePositiveInt(entryLimit, normalizedLimit, 500) !== normalizedLimit) {
      continue;
    }

    const createdAt = entry.expiresAt - SNAPSHOT_CACHE_TTL_MS;
    if ((nowMs - createdAt) > SNAPSHOT_STALE_MAX_AGE_MS) {
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

function buildSnapshotFromContributionSeries({ payload, index, requestedTs, limit }) {
  const snapshots = payload?.snapshots && typeof payload.snapshots === "object" ? payload.snapshots : {};
  const allowedSymbols = getAllowedConstituentSetFromContributionSeries(payload, index);
  const entries = Object.entries(snapshots)
    .map(([key, value]) => [asFiniteNumber(key, NaN), value])
    .filter(([timestamp]) => Number.isFinite(timestamp))
    .sort((a, b) => a[0] - b[0]);

  if (!entries.length) {
    throw new Error("selected timestamp contribution snapshot unavailable");
  }

  const [timestamp, rawRows] = entries[0];
  const rows = Object.entries(rawRows && typeof rawRows === "object" ? rawRows : {})
    .map(([symbol, row]) => ({
      symbol: String(symbol || "").trim().toUpperCase(),
      metrics: {
        per_change: asFiniteNumber(row?.per_change, 0),
        per_to_index: asFiniteNumber(row?.per_to_index, 0),
        point_to_index: asFiniteNumber(row?.point_to_index, 0)
      }
    }))
    .filter((row) => {
      if (!row.symbol) {
        return false;
      }
      if (!allowedSymbols || allowedSymbols.size === 0) {
        return true;
      }
      return allowedSymbols.has(row.symbol);
    })
    .sort((a, b) => {
      const absDiff = Math.abs(b.metrics.point_to_index) - Math.abs(a.metrics.point_to_index);
      if (absDiff !== 0) {
        return absDiff;
      }
      return a.symbol.localeCompare(b.symbol);
    })
    .slice(0, Math.max(1, parsePositiveInt(limit, 20, 500)))
    .map((row, indexPosition) => ({
      rank: indexPosition + 1,
      ...row
    }));

  return {
    index_key: String(index || payload?.symbol || "NIFTY50").toUpperCase(),
    index_name: String(payload?.symbol || index || "NIFTY50"),
    timestamp: asFiniteNumber(timestamp, asFiniteNumber(requestedTs, 0)),
    source: "fallback:contribution-series",
    row_count: rows.length,
    rows,
    from_db: false,
    market_open: true
  };
}

function toLeanMoversSnapshotPayload(payload, { requestedTs, index, limit }) {
  const rows = (Array.isArray(payload?.rows) ? payload.rows : [])
    .slice(0, Math.max(1, parsePositiveInt(limit, 20, 500)))
    .map((row, rowIndex) => ({
      rank: asFiniteNumber(row?.rank, rowIndex + 1),
      symbol: String(row?.symbol || "").trim().toUpperCase(),
      metrics: {
        per_change: asFiniteNumber(row?.metrics?.per_change, 0),
        per_to_index: asFiniteNumber(row?.metrics?.per_to_index, 0),
        point_to_index: asFiniteNumber(row?.metrics?.point_to_index, 0)
      }
    }))
    .filter((row) => row.symbol);

  return {
    index_key: String(payload?.index_key || index || "").toUpperCase(),
    index_name: String(payload?.index_name || index || ""),
    timestamp: asFiniteNumber(payload?.timestamp, asFiniteNumber(requestedTs, 0)),
    source: String(payload?.source || "db:index_movers_1m"),
    row_count: rows.length,
    rows,
    from_db: Boolean(payload?.from_db),
    market_open: Boolean(payload?.market_open)
  };
}

function getClosedMinuteCutoff(interval = "1m") {
  const intervalKey = String(interval || "1m").toLowerCase().trim();
  const intervalSeconds = intervalKey === "15m" ? 900 : intervalKey === "3m" ? 180 : 60;
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const currentMinute = Math.floor(istNow.getTime() / 1000 / 60) * 60;
  return currentMinute - intervalSeconds;
}

function getISTDateFromUnix(unixSeconds) {
  const date = new Date(Number(unixSeconds || 0) * 1000);
  return new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

function minuteToUnixForISTDate(parts, minuteOfDay) {
  const minute = Math.max(0, Math.min(1439, Math.floor(Number(minuteOfDay) || 0)));
  const midnightUtcSeconds = Math.floor(Date.UTC(parts.year, parts.month, parts.day, 0, 0, 0, 0) / 1000);
  const istOffsetSeconds = (5 * 3600) + (30 * 60);
  return midnightUtcSeconds - istOffsetSeconds + (minute * 60);
}

function buildSnapshotFallbackTimestampList(requestTimestamp) {
  const requestTs = normalizeTimestampToMinute(requestTimestamp);
  if (!requestTs) {
    return [];
  }

  const requestIstDate = getISTDateFromUnix(requestTs);
  const requestMinute = (requestIstDate.getHours() * 60) + requestIstDate.getMinutes();
  const sessionOpenMinute = (9 * 60) + 15;
  const sessionCloseMinute = (15 * 60) + 29;
  const clampedMinute = requestMinute < sessionOpenMinute
    ? sessionCloseMinute
    : Math.min(requestMinute, sessionCloseMinute);

  const candidates = [requestTs, requestTs - 60];
  const cursor = new Date(Date.UTC(
    requestIstDate.getFullYear(),
    requestIstDate.getMonth(),
    requestIstDate.getDate(),
    0,
    0,
    0,
    0
  ));

  while (candidates.length < 3) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const local = new Date(cursor.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const weekday = local.getDay();
    if (weekday === 0 || weekday === 6) {
      continue;
    }
    const parts = {
      year: local.getFullYear(),
      month: local.getMonth(),
      day: local.getDate()
    };
    candidates.push(
      minuteToUnixForISTDate(parts, clampedMinute),
      minuteToUnixForISTDate(parts, sessionCloseMinute)
    );
  }

  const out = [];
  const seen = new Set();
  for (const rawTs of candidates) {
    const ts = normalizeTimestampToMinute(rawTs);
    if (!ts || ts <= 0 || seen.has(ts)) {
      continue;
    }
    seen.add(ts);
    out.push(ts);
    if (out.length >= 3) {
      break;
    }
  }
  return out;
}

function hasRows(payload) {
  return Array.isArray(payload?.rows) && payload.rows.length > 0;
}

export async function GET(request) {
  logSnapshotRequest("request", request);
  const auth = await requireMarketAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const params = request.nextUrl.searchParams;
  const index = params.get("index") || "NIFTY50";
  const interval = params.get("interval") || "1m";
  const tsRaw = params.get("ts") || params.get("timestamp") || params.get("at");
  const limit = parsePositiveInt(params.get("limit") || "50", 50, 500);
  const allowFallback = parseBoolFlag(params.get("allow_fallback"), true);

  if (!tsRaw) {
    logSnapshotRequest("bad_request", request, { reason: "missing ts" });
    return NextResponse.json({ error: "ts is required" }, { status: 400 });
  }

  let ts = normalizeTimestampToMinute(tsRaw);
  if (!ts) {
    logSnapshotRequest("bad_request", request, { reason: "invalid ts", tsRaw });
    return NextResponse.json({ error: "invalid ts" }, { status: 400 });
  }

  const closedMinuteCutoff = getClosedMinuteCutoff(interval);
  if (Number.isFinite(closedMinuteCutoff) && ts > closedMinuteCutoff) {
    ts = closedMinuteCutoff;
  }
  if (!Number.isFinite(ts) || ts <= 0) {
    logSnapshotRequest("bad_request", request, { reason: "no closed candle available", interval });
    return NextResponse.json({ error: "no closed candle available yet" }, { status: 400 });
  }

  const cacheKey = `${String(index).toUpperCase()}:${String(interval)}:${ts}:${limit}:${allowFallback ? "fb1" : "fb0"}`;
  const nowMs = Date.now();
  const cached = snapshotCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) {
    return NextResponse.json(cached.payload, { status: 200 });
  }

  if (snapshotInflight.has(cacheKey)) {
    try {
      const payload = await snapshotInflight.get(cacheKey);
      return NextResponse.json(payload, { status: 200 });
    } catch (error) {
      const message = String(error?.message || "Failed to fetch movers snapshot");
      const status = classifySnapshotError(error);
      const staleByIndex = findRecentSnapshotCacheForIndex({ index, interval, limit });
      if (staleByIndex) {
        logSnapshotRequest("stale_fallback", request, { reason: message, index, interval, ts });
        return NextResponse.json(staleByIndex, { status: 200 });
      }
      if (allowFallback) {
        logSnapshotRequest("error_fallback", request, {
          reason: message,
          index,
          interval,
          ts,
          attemptedTimestamps: Array.isArray(error?.attemptedTimestamps) ? error.attemptedTimestamps : []
        });
        return NextResponse.json(
          {
            error: message || "No movers snapshot data available",
            status,
            details: {
              index,
              interval,
              requestTimestamp: ts,
              attemptedTimestamps: Array.isArray(error?.attemptedTimestamps) ? error.attemptedTimestamps : []
            }
          },
          { status: 200 }
        );
      }
      logSnapshotRequest("error", request, { status, message });
      return NextResponse.json(
        {
          error: message,
          from_db_only: true,
          fallback_available: true
        },
        { status }
      );
    }
  }

  try {
    const buildPromise = (async () => {
      const fallbackTimestamps = buildSnapshotFallbackTimestampList(ts);
      const attemptedTimestamps = [];

      const fetchDbSnapshot = async (candidateTs) => {
        attemptedTimestamps.push(candidateTs);
        const dbPayload = await fetchMoversSnapshotWithTimeout({
          index,
          ts: candidateTs,
          limit,
          dbOnly: true,
          timeoutMs: SNAPSHOT_DB_FETCH_TIMEOUT_MS
        });
        const leanPayload = toLeanMoversSnapshotPayload(dbPayload, { requestedTs: ts, index, limit });
        if (!hasRows(leanPayload)) {
          return null;
        }
        if (candidateTs !== ts) {
          leanPayload.partial = true;
          leanPayload.warning = `fallback_ts:${candidateTs}`;
          leanPayload.timestamp = candidateTs;
        }
        return leanPayload;
      };

      try {
        for (const candidateTs of fallbackTimestamps) {
          const payload = await fetchDbSnapshot(candidateTs);
          if (payload) {
            snapshotCache.set(cacheKey, {
              payload,
              expiresAt: Date.now() + SNAPSHOT_CACHE_TTL_MS
            });
            if (snapshotCache.size > 48) {
              const firstKey = snapshotCache.keys().next().value;
              snapshotCache.delete(firstKey);
            }
            return payload;
          }
        }
      } catch (error) {
        const message = String(error?.message || "");
        const status = Number(error?.status);
        const shouldFallback =
          /no movers snapshot found/i.test(message) ||
          message.toLowerCase().includes("timeout") ||
          status === 404;

        if (!shouldFallback || !allowFallback) {
          throw error;
        }

        logSnapshotRequest("fallback", request, {
          reason: message || "db snapshot miss/timeout",
          index,
          interval,
          ts
        });

        for (const candidateTs of fallbackTimestamps) {
          attemptedTimestamps.push(candidateTs);
          try {
            const contributionPayload = await fetchContributionSeriesWithTimeout({
              symbol: index,
              interval,
              at: candidateTs,
              onlySelected: true,
              timeoutMs: SNAPSHOT_FALLBACK_FETCH_TIMEOUT_MS
            });
            const payload = buildSnapshotFromContributionSeries({
              payload: contributionPayload,
              index,
              requestedTs: candidateTs,
              limit
            });
            if (!hasRows(payload)) {
              continue;
            }
            if (candidateTs !== ts) {
              payload.partial = true;
              payload.warning = `fallback_ts:${candidateTs}`;
              payload.timestamp = candidateTs;
            }
            snapshotCache.set(cacheKey, {
              payload,
              expiresAt: Date.now() + 15_000
            });
            if (snapshotCache.size > 48) {
              const firstKey = snapshotCache.keys().next().value;
              snapshotCache.delete(firstKey);
            }
            return payload;
          } catch {
            // try next fallback timestamp
          }
        }

        const noDataError = new Error("No movers snapshot data available for requested timestamp and fallback window");
        noDataError.attemptedTimestamps = attemptedTimestamps;
        throw noDataError;
      }
    })();

    snapshotInflight.set(cacheKey, buildPromise);
    const payload = await buildPromise;
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    const message = String(error?.message || "Failed to fetch movers snapshot");
    const status = classifySnapshotError(error);
    const staleByIndex = findRecentSnapshotCacheForIndex({ index, interval, limit });
    if (staleByIndex) {
      logSnapshotRequest("stale_fallback", request, { reason: message, index, interval, ts });
      return NextResponse.json(staleByIndex, { status: 200 });
    }
    if (allowFallback) {
      logSnapshotRequest("error_fallback", request, {
        reason: message,
        index,
        interval,
        ts,
        attemptedTimestamps: Array.isArray(error?.attemptedTimestamps) ? error.attemptedTimestamps : []
      });
      return NextResponse.json(
        {
          error: message || "No movers snapshot data available",
          status,
          details: {
            index,
            interval,
            requestTimestamp: ts,
            attemptedTimestamps: Array.isArray(error?.attemptedTimestamps) ? error.attemptedTimestamps : []
          }
        },
        { status: 200 }
      );
    }
    logSnapshotRequest("error", request, { status, message });
    return NextResponse.json(
      {
        error: message,
        from_db_only: true,
        fallback_available: true
      },
      { status }
    );
  } finally {
    snapshotInflight.delete(cacheKey);
  }
}
