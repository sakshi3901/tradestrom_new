import { NextResponse } from "next/server";
import { fetchOptionSnapshot } from "@/lib/api";
import { requireMarketAccess } from "@/lib/routeAccess";

const NSE_NIFTY50_URL = "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050";
const NSE_LIVE_ADVANCE_URL = "https://www.nseindia.com/api/live-analysis-advance";
const NSE_LIVE_52WEEK_URL = "https://www.nseindia.com/api/live-analysis-52weekhighstock";
const NSE_LIVE_PRICE_BAND_URL = "https://www.nseindia.com/api/live-analysis-price-band-hitter";
const NSE_HOME_URL = "https://www.nseindia.com/";

const NSE_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.nseindia.com/market-data/live-equity-market?symbol=NIFTY",
  "User-Agent": "Mozilla/5.0 Tradestrom/1.0"
};

const OVERVIEW_CACHE_TTL_MS = 45 * 1000;
const OVERVIEW_STALE_MAX_AGE_MS = 5 * 60 * 1000;
const NSE_BUNDLE_CACHE_TTL_MS = 20 * 1000;
const NSE_BUNDLE_STALE_MAX_AGE_MS = 5 * 60 * 1000;
const NSE_FETCH_TIMEOUT_MS = 1200;
const OVERVIEW_BUILD_TIMEOUT_MS = 1300;
const OPTION_SNAPSHOT_TIMEOUT_MS = 1000;
let overviewCache = new Map();
let overviewInflight = new Map();
let nseBundleCache = null;
let nseBundleCacheExpiresAt = 0;
let nseBundleCacheCreatedAt = 0;
let nseBundleInflight = null;

function logMarketOverview(stage, details = {}) {
  try {
    console.info(`[api/market/overview] ${stage}`, details);
  } catch {
    // no-op
  }
}

function getFetchTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function withTimeout(promise, timeoutMs) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("market overview timeout")), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function parseLeanFlag(value) {
  if (value === undefined || value === null) {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function splitSetCookieHeader(headerValue) {
  if (!headerValue) {
    return [];
  }

  return headerValue
    .split(/,(?=[^;,\s]+=)/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function fetchNseSessionCookies() {
  const response = await fetch(NSE_HOME_URL, {
    method: "GET",
    cache: "no-store",
    signal: getFetchTimeoutSignal(NSE_FETCH_TIMEOUT_MS),
    headers: {
      ...NSE_HEADERS,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: "https://www.nseindia.com/"
    }
  });

  if (!response.ok) {
    throw new Error(`NSE home request failed (${response.status})`);
  }

  const cookies = [];
  const setCookieGetter = response.headers.getSetCookie;
  if (typeof setCookieGetter === "function") {
    const setCookieList = setCookieGetter.call(response.headers) || [];
    cookies.push(...setCookieList);
  } else {
    cookies.push(...splitSetCookieHeader(response.headers.get("set-cookie")));
  }

  const cookieHeader = cookies
    .map((cookie) => String(cookie).split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");

  return cookieHeader;
}

function toNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function aggregateSnapshot(snapshot) {
  const strikes = Array.isArray(snapshot?.strikes) ? snapshot.strikes : [];

  let callOI = 0;
  let putOI = 0;
  let highestCallStrike = null;
  let highestPutStrike = null;
  let highestCallOI = 0;
  let highestPutOI = 0;

  for (const strike of strikes) {
    const strikePrice = toNumber(strike?.strike);
    const call = toNumber(strike?.call?.oi);
    const put = toNumber(strike?.put?.oi);

    callOI += call;
    putOI += put;

    if (call > highestCallOI) {
      highestCallOI = call;
      highestCallStrike = strikePrice;
    }

    if (put > highestPutOI) {
      highestPutOI = put;
      highestPutStrike = strikePrice;
    }
  }

  return {
    callOI,
    putOI,
    highestCallOI,
    highestCallStrike,
    highestPutOI,
    highestPutStrike
  };
}

function computeOiDelta(startSnapshot, endSnapshot) {
  const startStrikes = Array.isArray(startSnapshot?.strikes) ? startSnapshot.strikes : [];
  const endStrikes = Array.isArray(endSnapshot?.strikes) ? endSnapshot.strikes : [];

  const startByStrike = new Map();
  const endByStrike = new Map();

  for (const item of startStrikes) {
    startByStrike.set(String(toNumber(item?.strike)), item);
  }

  for (const item of endStrikes) {
    endByStrike.set(String(toNumber(item?.strike)), item);
  }

  const allStrikes = new Set([...startByStrike.keys(), ...endByStrike.keys()]);

  let callDelta = 0;
  let putDelta = 0;

  for (const strikeKey of allStrikes) {
    const startItem = startByStrike.get(strikeKey);
    const endItem = endByStrike.get(strikeKey);

    const startCall = toNumber(startItem?.call?.oi);
    const startPut = toNumber(startItem?.put?.oi);
    const endCall = toNumber(endItem?.call?.oi);
    const endPut = toNumber(endItem?.put?.oi);

    callDelta += endCall - startCall;
    putDelta += endPut - startPut;
  }

  return {
    callDelta,
    putDelta,
    netDelta: callDelta + putDelta
  };
}

function computeNiftyStats(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const indexRow = rows.find((item) => String(item?.symbol).toUpperCase() === "NIFTY 50") || null;
  const stocks = rows.filter((item) => String(item?.symbol).toUpperCase() !== "NIFTY 50");

  const advancePayload = payload?.advance || {};
  const stockAdvanced = toNumber(advancePayload.advances) || stocks.filter((row) => toNumber(row?.change) > 0).length;
  const stockDeclines = toNumber(advancePayload.declines) || stocks.filter((row) => toNumber(row?.change) < 0).length;
  const stockUnchanged = toNumber(advancePayload.unchanged) || stocks.filter((row) => toNumber(row?.change) === 0).length;
  const stockTraded = stockAdvanced + stockDeclines + stockUnchanged || stocks.length || rows.length;

  // Use intraday touch against 52-week bounds so these counters move during session.
  const high52Week = stocks.filter((row) => {
    const dayHigh = toNumber(row?.dayHigh);
    const yHigh = toNumber(row?.yearHigh);
    return dayHigh > 0 && yHigh > 0 && dayHigh >= yHigh - 0.001;
  }).length;

  const low52Week = stocks.filter((row) => {
    const dayLow = toNumber(row?.dayLow);
    const yLow = toNumber(row?.yearLow);
    return dayLow > 0 && yLow > 0 && dayLow <= yLow + 0.001;
  }).length;

  const upperCircuit = stocks.filter((row) => {
    const upper = toNumber(row?.upperCP);
    const lastPrice = toNumber(row?.lastPrice);
    if (upper > 0) {
      return lastPrice >= upper - 0.001;
    }

    const dayHigh = toNumber(row?.dayHigh);
    const dayLow = toNumber(row?.dayLow);
    const change = toNumber(row?.change);
    return dayHigh > 0 && dayLow > 0 && Math.abs(dayHigh - dayLow) < 0.0001 && change > 0;
  }).length;

  const lowerCircuit = stocks.filter((row) => {
    const lower = toNumber(row?.lowerCP);
    const lastPrice = toNumber(row?.lastPrice);
    if (lower > 0) {
      return lastPrice <= lower + 0.001;
    }

    const dayHigh = toNumber(row?.dayHigh);
    const dayLow = toNumber(row?.dayLow);
    const change = toNumber(row?.change);
    return dayHigh > 0 && dayLow > 0 && Math.abs(dayHigh - dayLow) < 0.0001 && change < 0;
  }).length;

  const indexPrice = toNumber(indexRow?.lastPrice) || toNumber(payload?.metadata?.last);
  const indexChangePct = toNumber(indexRow?.pChange) || toNumber(payload?.metadata?.percChange);
  const indexChange = toNumber(indexRow?.change) || toNumber(payload?.metadata?.change);
  const marketStatusRaw = String(payload?.marketStatus?.marketStatus || payload?.marketStatus?.status || "").toLowerCase();
  let isActive = marketStatusRaw.includes("open");
  if (!marketStatusRaw) {
    const now = new Date();
    const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const day = istNow.getDay();
    const minutes = istNow.getHours() * 60 + istNow.getMinutes();
    isActive = day >= 1 && day <= 5 && minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
  }

  return {
    quote: {
      symbol: "NIFTY 50",
      price: indexPrice,
      change: indexChange,
      changePct: indexChangePct,
      active: isActive
    },
    asOn: String(payload?.timestamp || payload?.marketStatus?.tradeDate || "").trim() || null,
    breadth: {
      stockTraded,
      stockAdvanced,
      stockDeclines,
      stockUnchanged
    },
    levels: {
      high52Week,
      low52Week,
      upperCircuit,
      lowerCircuit
    }
  };
}

function computeLiveAdvanceStats(payload) {
  if (!payload?.advance?.count) {
    return null;
  }

  const count = payload?.advance?.count || {};
  return {
    asOn: String(payload?.timestamp || "").trim() || null,
    breadth: {
      stockTraded: toNumber(count?.Total),
      stockAdvanced: toNumber(count?.Advances),
      stockDeclines: toNumber(count?.Declines),
      stockUnchanged: toNumber(count?.Unchange)
    }
  };
}

function compute52WeekSummary(payload) {
  if (!payload || (payload?.high === undefined && payload?.low === undefined)) {
    return null;
  }

  return {
    high52Week: toNumber(payload?.high),
    low52Week: toNumber(payload?.low)
  };
}

function computePriceBandSummary(payload) {
  if (!payload?.count) {
    return null;
  }

  const count = payload?.count || {};
  return {
    upperCircuit: toNumber(count?.UPPER),
    lowerCircuit: toNumber(count?.LOWER),
    totalBandHitters: toNumber(count?.TOTAL),
    bothBandHitters: toNumber(count?.BOTH)
  };
}

async function fetchNseJson(url, sessionCookie = "") {
  const tryFetch = async (withCookie) => {
    const headers = { ...NSE_HEADERS };
    if (withCookie && sessionCookie) {
      headers.Cookie = sessionCookie;
    }

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: getFetchTimeoutSignal(NSE_FETCH_TIMEOUT_MS),
      headers
    });

    if (!response.ok) {
      throw new Error(`NSE request failed (${response.status})`);
    }

    return response.json();
  };

  if (sessionCookie) {
    try {
      return await tryFetch(true);
    } catch (_) {
      return tryFetch(false);
    }
  }

  return tryFetch(false);
}

async function fetchNseBundle() {
  let sessionCookie = "";
  try {
    sessionCookie = await fetchNseSessionCookies();
  } catch (_) {
    sessionCookie = "";
  }

  const [niftyResult, liveAdvanceResult, live52WeekResult, livePriceBandResult] = await Promise.allSettled([
    fetchNseJson(NSE_NIFTY50_URL, sessionCookie),
    fetchNseJson(NSE_LIVE_ADVANCE_URL, sessionCookie),
    fetchNseJson(NSE_LIVE_52WEEK_URL, sessionCookie),
    fetchNseJson(NSE_LIVE_PRICE_BAND_URL, sessionCookie)
  ]);
  const fallbackBundle = nseBundleCache && (Date.now() - nseBundleCacheCreatedAt) <= NSE_BUNDLE_STALE_MAX_AGE_MS
    ? nseBundleCache
    : null;

  const niftyPayload = niftyResult.status === "fulfilled"
    ? niftyResult.value
    : (fallbackBundle?.niftyPayload || null);
  if (!niftyPayload) {
    throw new Error("NSE NIFTY payload unavailable");
  }

  return {
    niftyPayload,
    liveAdvancePayload: liveAdvanceResult.status === "fulfilled"
      ? liveAdvanceResult.value
      : (fallbackBundle?.liveAdvancePayload || null),
    live52WeekPayload: live52WeekResult.status === "fulfilled"
      ? live52WeekResult.value
      : (fallbackBundle?.live52WeekPayload || null),
    livePriceBandPayload: livePriceBandResult.status === "fulfilled"
      ? livePriceBandResult.value
      : (fallbackBundle?.livePriceBandPayload || null)
  };
}

async function fetchNseBundleCached() {
  const now = Date.now();
  if (nseBundleCache && nseBundleCacheExpiresAt > now) {
    return nseBundleCache;
  }

  if (nseBundleInflight) {
    return nseBundleInflight;
  }

  const promise = fetchNseBundle()
    .then((bundle) => {
      nseBundleCache = bundle;
      nseBundleCacheCreatedAt = Date.now();
      nseBundleCacheExpiresAt = nseBundleCacheCreatedAt + NSE_BUNDLE_CACHE_TTL_MS;
      return bundle;
    })
    .catch((error) => {
      if (nseBundleCache && (Date.now() - nseBundleCacheCreatedAt) <= NSE_BUNDLE_STALE_MAX_AGE_MS) {
        return nseBundleCache;
      }
      throw error;
    })
    .finally(() => {
      nseBundleInflight = null;
    });

  nseBundleInflight = promise;
  return promise;
}

function buildOverviewCacheKey({ from, to, lean, minuteKey }) {
  if (lean) {
    return `lean:${String(minuteKey || "")}`;
  }
  return `${from}:${to}:full:${String(minuteKey || "")}`;
}

function findRecentOverviewCache({ lean }) {
  const now = Date.now();
  let best = null;
  const expectedPrefix = lean ? "lean:" : "";

  for (const [key, entry] of overviewCache.entries()) {
    if (!entry?.payload) {
      continue;
    }
    if (lean && !String(key).startsWith(expectedPrefix)) {
      continue;
    }
    const createdAt = Number(entry.createdAt || 0);
    if (!Number.isFinite(createdAt) || (now - createdAt) > OVERVIEW_STALE_MAX_AGE_MS) {
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

export async function GET(request) {
  const startedAt = Date.now();
  const auth = await requireMarketAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const params = request.nextUrl.searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const lean = parseLeanFlag(params.get("lean"));
  const minuteKey = params.get("minute_key") || "";

  if (!from || !to) {
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }

  const cacheKey = buildOverviewCacheKey({ from, to, lean, minuteKey });
  const now = Date.now();
  const cached = overviewCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    logMarketOverview("cache_hit", {
      lean,
      from,
      to,
      durationMs: Date.now() - startedAt
    });
    return NextResponse.json(cached.payload, { status: 200 });
  }

  if (overviewInflight.has(cacheKey)) {
    try {
      const payload = await overviewInflight.get(cacheKey);
      logMarketOverview("inflight_hit", {
        lean,
        from,
        to,
        durationMs: Date.now() - startedAt
      });
      return NextResponse.json(payload, { status: 200 });
    } catch (error) {
      const stale = findRecentOverviewCache({ lean });
      if (stale) {
        logMarketOverview("stale_cache_hit", {
          lean,
          from,
          to,
          durationMs: Date.now() - startedAt
        });
        return NextResponse.json(stale, { status: 200 });
      }
      logMarketOverview("error", {
        lean,
        from,
        to,
        durationMs: Date.now() - startedAt,
        error: error?.message || "Failed to fetch market overview"
      });
      return NextResponse.json({ error: error.message || "Failed to fetch market overview" }, { status: 500 });
    }
  }

  try {
    const buildPromise = withTimeout((async () => {
      const nowUnix = Math.floor(Date.now() / 1000);
      const sameRangePoint = String(from) === String(to);
      const startSnapshotPromise = lean
        ? Promise.resolve(null)
        : fetchOptionSnapshot({ time: from, timeoutMs: OPTION_SNAPSHOT_TIMEOUT_MS }).catch(() => null);
      const endSnapshotPromise = lean
        ? Promise.resolve(null)
        : (sameRangePoint ? startSnapshotPromise : fetchOptionSnapshot({ time: to, timeoutMs: OPTION_SNAPSHOT_TIMEOUT_MS }).catch(() => null));
      const liveSnapshotPromise = lean
        ? Promise.resolve(null)
        : (sameRangePoint ? Promise.resolve(null) : fetchOptionSnapshot({ time: nowUnix, timeoutMs: OPTION_SNAPSHOT_TIMEOUT_MS }).catch(() => null));

      const [startSnapshot, endSnapshot, liveSnapshot, nseBundle] = await Promise.all([
        startSnapshotPromise,
        endSnapshotPromise,
        liveSnapshotPromise,
        fetchNseBundleCached()
      ]);

      const niftyPayload = nseBundle?.niftyPayload || null;
      const liveAdvancePayload = nseBundle?.liveAdvancePayload || null;
      const live52WeekPayload = nseBundle?.live52WeekPayload || null;
      const livePriceBandPayload = nseBundle?.livePriceBandPayload || null;

      const startSummary = aggregateSnapshot(startSnapshot);
      const endSummary = aggregateSnapshot(endSnapshot);
      const liveSummary = aggregateSnapshot(liveSnapshot);
      const delta = computeOiDelta(startSnapshot, endSnapshot);
      const market = computeNiftyStats(niftyPayload);
      const liveAdvance = computeLiveAdvanceStats(liveAdvancePayload);
      const live52Week = compute52WeekSummary(live52WeekPayload);
      const livePriceBand = computePriceBandSummary(livePriceBandPayload);

      const breadth = liveAdvance?.breadth || market?.breadth || {
        stockTraded: 0,
        stockAdvanced: 0,
        stockDeclines: 0,
        stockUnchanged: 0
      };

      const levels = {
        high52Week: live52Week?.high52Week ?? market?.levels?.high52Week ?? 0,
        low52Week: live52Week?.low52Week ?? market?.levels?.low52Week ?? 0,
        upperCircuit: livePriceBand?.upperCircuit ?? market?.levels?.upperCircuit ?? 0,
        lowerCircuit: livePriceBand?.lowerCircuit ?? market?.levels?.lowerCircuit ?? 0
      };

      const totalStartOI = startSummary.callOI + startSummary.putOI;
      const totalEndOI = endSummary.callOI + endSummary.putOI;

      const pcr = endSummary.callOI !== 0 ? endSummary.putOI / endSummary.callOI : 0;
      const oiChangePcr = delta.callDelta !== 0 ? delta.putDelta / delta.callDelta : 0;
      const netOiChangePct = totalStartOI > 0 ? (delta.netDelta / totalStartOI) * 100 : 0;

      const response = {
        fromTimestamp: Number(from),
        toTimestamp: Number(to),
        quote: market.quote,
        oiTotals: {
          calls: endSummary.callOI,
          puts: endSummary.putOI,
          total: totalEndOI,
          pcr
        },
        oiChange: {
          calls: delta.callDelta,
          puts: delta.putDelta,
          net: delta.netDelta,
          netPct: netOiChangePct,
          pcr: oiChangePcr
        },
        highestOI: {
          asOfTimestamp: toNumber(liveSnapshot?.timestamp) || toNumber(endSnapshot?.timestamp) || null,
          callStrike: liveSummary.highestCallStrike || endSummary.highestCallStrike,
          callOI: liveSummary.highestCallOI || endSummary.highestCallOI,
          putStrike: liveSummary.highestPutStrike || endSummary.highestPutStrike,
          putOI: liveSummary.highestPutOI || endSummary.highestPutOI
        },
        marketStatistics: {
          asOn: liveAdvance?.asOn || market.asOn
        },
        breadth,
        levels,
        aty: Math.abs(toNumber(market.quote.changePct)) >= 0.75 ? "High" : "Medium"
      };

      overviewCache.set(cacheKey, {
        payload: response,
        createdAt: Date.now(),
        expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS
      });
      if (overviewCache.size > 12) {
        const firstKey = overviewCache.keys().next().value;
        overviewCache.delete(firstKey);
      }

      return response;
    })(), OVERVIEW_BUILD_TIMEOUT_MS);

    overviewInflight.set(cacheKey, buildPromise);
    const response = await buildPromise;
    logMarketOverview("success", {
      lean,
      from,
      to,
      durationMs: Date.now() - startedAt
    });
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const stale = findRecentOverviewCache({ lean });
    if (stale) {
      logMarketOverview("stale_cache_hit", {
        lean,
        from,
        to,
        durationMs: Date.now() - startedAt
      });
      return NextResponse.json(stale, { status: 200 });
    }
    logMarketOverview("error", {
      lean,
      from,
      to,
      durationMs: Date.now() - startedAt,
      error: error?.message || "Failed to fetch market overview"
    });
    return NextResponse.json({ error: error.message || "Failed to fetch market overview" }, { status: 500 });
  } finally {
    overviewInflight.delete(cacheKey);
  }
}
