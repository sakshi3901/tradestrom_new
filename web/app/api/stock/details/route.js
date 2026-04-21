import { NextResponse } from "next/server";
import { requireMarketAccess } from "@/lib/routeAccess";

const NSE_HOME_URL = "https://www.nseindia.com/";
const NSE_QUOTE_EQUITY_URL = "https://www.nseindia.com/api/quote-equity";
const NSE_ARCHIVE_BHAVCOPY_BASE = "https://archives.nseindia.com/products/content";

const NSE_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.nseindia.com/market-data/live-equity-market",
  "User-Agent": "Mozilla/5.0 Tradestrom/1.0"
};

const QUOTE_TIMEOUT_MS = 1500;
const DELIVERY_FETCH_TIMEOUT_MS = 1200;
const DAY_ARCHIVE_TIMEOUT_MS = 800;
const DETAILS_CACHE_TTL_MS = 60 * 1000;
const DETAILS_STALE_MAX_AGE_MS = 10 * 60 * 1000;
const DETAILS_REQUEST_BUDGET_MS = 1200;
const DAY_ARCHIVE_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_DAYS_LOOKBACK = 15;
const MAX_CANDIDATE_WEEKDAYS = 40;

const detailsCache = new Map();
const detailsInflight = new Map();
const dayArchiveCache = new Map();
const dayArchiveInflight = new Map();

function logStockDetailsRequest(stage, request, details = {}) {
  try {
    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    console.info("[api/stock/details] " + stage, {
      method: request.method,
      path: request.nextUrl.pathname,
      params,
      ...details
    });
  } catch {
    // no-op
  }
}

function classifyStockDetailsError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("required") || message.includes("invalid")) {
    return 400;
  }
  if (message.includes("not found") || message.includes("unsupported")) {
    return 404;
  }
  if (message.includes("timeout")) {
    return 504;
  }
  return 500;
}

function asFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parsePositiveInt(value, fallback, max = 60) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(numeric), max);
}

function toNseNumber(value, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function formatArchiveDateCode(date) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  return `${day}${month}${year}`;
}

function parseNseDateToUnix(dateText) {
  const text = String(dateText || "").trim();
  if (!text) {
    return 0;
  }
  const parsed = Date.parse(`${text} GMT+0530`);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return Math.floor(parsed / 1000);
}

function formatDeliveryDateLabel(unixSeconds) {
  const numeric = Number(unixSeconds);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Kolkata"
  }).format(new Date(numeric * 1000));
}

function getFetchTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

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

function splitSetCookieHeader(headerValue) {
  if (!headerValue) {
    return [];
  }

  return String(headerValue)
    .split(/,(?=[^;,\s]+=)/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function fetchNseSessionCookieHeader() {
  const response = await fetch(NSE_HOME_URL, {
    method: "GET",
    cache: "no-store",
    signal: getFetchTimeoutSignal(QUOTE_TIMEOUT_MS),
    headers: {
      ...NSE_HEADERS,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: NSE_HOME_URL
    }
  });

  if (!response.ok) {
    throw new Error(`NSE home request failed (${response.status})`);
  }

  const cookies = [];
  if (typeof response.headers.getSetCookie === "function") {
    cookies.push(...(response.headers.getSetCookie() || []));
  } else {
    cookies.push(...splitSetCookieHeader(response.headers.get("set-cookie")));
  }

  return cookies
    .map((cookie) => String(cookie).split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function fetchNseJson(url, sessionCookie, timeoutMs, errorLabel) {
  const headers = { ...NSE_HEADERS };
  if (sessionCookie) {
    headers.Cookie = sessionCookie;
  }

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: getFetchTimeoutSignal(timeoutMs),
    headers
  });

  if (!response.ok) {
    throw new Error(`${errorLabel} (${response.status})`);
  }

  return response.json();
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function parseBhavcopyCsvForSymbol(csvText, targetSymbol) {
  const normalizedTarget = String(targetSymbol || "").trim().toUpperCase();
  if (!normalizedTarget) {
    return null;
  }

  const text = String(csvText || "");
  if (!text.trim()) {
    return null;
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return null;
  }

  const header = splitCsvLine(lines[0]).map((column) => String(column).trim().toUpperCase());
  const indexByName = new Map(header.map((column, index) => [column, index]));
  const symbolIdx = indexByName.get("SYMBOL");
  const seriesIdx = indexByName.get("SERIES");
  const dateIdx = indexByName.get("DATE1");
  const deliveryPctIdx = indexByName.get("DELIV_PER");
  const closeIdx = indexByName.get("CLOSE_PRICE");

  if ([symbolIdx, seriesIdx, dateIdx, deliveryPctIdx].some((value) => !Number.isInteger(value))) {
    return null;
  }

  for (const line of lines.slice(1)) {
    const row = splitCsvLine(line);
    const symbol = String(row[symbolIdx] || "").trim().toUpperCase();
    const series = String(row[seriesIdx] || "").trim().toUpperCase();
    if (symbol !== normalizedTarget || series !== "EQ") {
      continue;
    }

    const dateText = String(row[dateIdx] || "").trim();
    const timestamp = parseNseDateToUnix(dateText);
    const deliveryPercent = toNseNumber(row[deliveryPctIdx], NaN);
    const closePrice = Number.isInteger(closeIdx) ? toNseNumber(row[closeIdx], NaN) : NaN;
    if (!Number.isFinite(deliveryPercent)) {
      return null;
    }
    return {
      symbol,
      dateText,
      timestamp,
      deliveryPercent,
      closePrice: Number.isFinite(closePrice) ? closePrice : null
    };
  }

  return null;
}

function trimCaches(cacheMap, maxSize) {
  if (cacheMap.size <= maxSize) {
    return;
  }
  const keys = cacheMap.keys();
  while (cacheMap.size > maxSize) {
    const first = keys.next();
    if (first.done) {
      break;
    }
    cacheMap.delete(first.value);
  }
}

function findRecentDetailsCacheBySymbol(symbol) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  if (!normalizedSymbol) {
    return null;
  }
  const now = Date.now();
  let best = null;
  for (const [key, entry] of detailsCache.entries()) {
    const [entrySymbol = ""] = String(key).split(":");
    if (String(entrySymbol).toUpperCase() !== normalizedSymbol) {
      continue;
    }
    if (!entry?.payload || typeof entry.payload !== "object") {
      continue;
    }
    const createdAt = Number(entry.expiresAt || 0) - DETAILS_CACHE_TTL_MS;
    if (!Number.isFinite(createdAt) || (now - createdAt) > DETAILS_STALE_MAX_AGE_MS) {
      continue;
    }
    if (!best || createdAt > best.createdAt) {
      best = {
        payload: entry.payload,
        createdAt
      };
    }
  }
  if (!best) {
    return null;
  }
  return {
    ...best.payload,
    stale: true
  };
}

async function fetchBhavcopyDayRow(date, symbol) {
  const dayCode = formatArchiveDateCode(date);
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const cacheKey = `${dayCode}:${normalizedSymbol}`;
  const now = Date.now();
  const cached = dayArchiveCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.payload;
  }

  if (dayArchiveInflight.has(cacheKey)) {
    return dayArchiveInflight.get(cacheKey);
  }

  const url = `${NSE_ARCHIVE_BHAVCOPY_BASE}/sec_bhavdata_full_${dayCode}.csv`;
  const promise = withTimeout((async () => {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: getFetchTimeoutSignal(DAY_ARCHIVE_TIMEOUT_MS),
      headers: {
        "User-Agent": NSE_HEADERS["User-Agent"],
        Accept: "text/csv,text/plain,*/*",
        Referer: "https://www.nseindia.com/"
      }
    });

    if (!response.ok) {
      throw new Error(`Bhavcopy request failed (${response.status})`);
    }

    const csvText = await response.text();
    const payload = parseBhavcopyCsvForSymbol(csvText, normalizedSymbol);
    dayArchiveCache.set(cacheKey, {
      payload,
      expiresAt: Date.now() + DAY_ARCHIVE_CACHE_TTL_MS
    });
    trimCaches(dayArchiveCache, 96);
    return payload;
  })(), DAY_ARCHIVE_TIMEOUT_MS + 200, "bhavcopy day request timeout").finally(() => {
    dayArchiveInflight.delete(cacheKey);
  });

  dayArchiveInflight.set(cacheKey, promise);
  return promise;
}

function getRecentWeekdayDatesIST(maxWeekdays = MAX_CANDIDATE_WEEKDAYS) {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const dates = [];

  for (let offset = 0; dates.length < maxWeekdays && offset < 80; offset += 1) {
    const candidate = new Date(Date.UTC(
      istNow.getFullYear(),
      istNow.getMonth(),
      istNow.getDate() - offset,
      0, 0, 0, 0
    ));
    const day = candidate.getUTCDay();
    if (day === 0 || day === 6) {
      continue;
    }
    dates.push(candidate);
  }

  return dates;
}

async function fetchDeliveryTrendForSymbol(symbol, days = MAX_DAYS_LOOKBACK) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  if (!normalizedSymbol) {
    return [];
  }

  const targetCount = Math.max(1, Math.min(days, MAX_DAYS_LOOKBACK));
  const candidateDates = getRecentWeekdayDatesIST(MAX_CANDIDATE_WEEKDAYS);
  const results = [];

  for (let cursor = 0; cursor < candidateDates.length && results.length < targetCount; cursor += 4) {
    const batch = candidateDates.slice(cursor, cursor + 4);
    const rows = await Promise.allSettled(batch.map((date) => fetchBhavcopyDayRow(date, normalizedSymbol)));

    for (const settled of rows) {
      if (settled.status !== "fulfilled") {
        continue;
      }
      const row = settled.value;
      if (!row || !Number.isFinite(Number(row.deliveryPercent))) {
        continue;
      }
      results.push({
        symbol: normalizedSymbol,
        timestamp: asFiniteNumber(row.timestamp, 0),
        date: row.dateText || "",
        dateLabel: formatDeliveryDateLabel(row.timestamp),
        deliveryPercent: Number(Number(row.deliveryPercent).toFixed(2)),
        closePrice: row.closePrice
      });
      if (results.length >= targetCount) {
        break;
      }
    }
  }

  return results
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-targetCount);
}

function buildQuoteSummary(symbol, quotePayload) {
  const priceInfo = quotePayload?.priceInfo && typeof quotePayload.priceInfo === "object" ? quotePayload.priceInfo : {};
  const weekHighLow = priceInfo?.weekHighLow && typeof priceInfo.weekHighLow === "object" ? priceInfo.weekHighLow : {};
  const metadata = quotePayload?.metadata && typeof quotePayload.metadata === "object" ? quotePayload.metadata : {};
  const securityInfo = quotePayload?.securityInfo && typeof quotePayload.securityInfo === "object" ? quotePayload.securityInfo : {};
  const industryInfo = quotePayload?.industryInfo && typeof quotePayload.industryInfo === "object" ? quotePayload.industryInfo : {};
  const info = quotePayload?.info && typeof quotePayload.info === "object" ? quotePayload.info : {};

  const currentPrice = toNseNumber(priceInfo.lastPrice ?? weekHighLow.value, 0);
  const percentChange = toNseNumber(priceInfo.pChange, 0);
  const weekLow = toNseNumber(weekHighLow.min, 0);
  const weekHigh = toNseNumber(weekHighLow.max, 0);
  const sliderValue = currentPrice || toNseNumber(weekHighLow.value, 0);
  const previousClose = toNseNumber(priceInfo.previousClose ?? priceInfo.close, 0);
  const open = toNseNumber(priceInfo.open, 0);
  const dayHigh = toNseNumber(priceInfo?.intraDayHighLow?.max, 0);
  const dayLow = toNseNumber(priceInfo?.intraDayHighLow?.min, 0);
  const vwap = toNseNumber(priceInfo?.vwap, 0);
  const symbolPe = toNseNumber(metadata.pdSymbolPe, NaN);
  const sectorPe = toNseNumber(metadata.pdSectorPe, NaN);
  const issuedSize = toNseNumber(securityInfo.issuedSize, NaN);
  const estimatedMarketCapCr = Number.isFinite(issuedSize) && issuedSize > 0 && currentPrice > 0
    ? (issuedSize * currentPrice) / 10000000
    : NaN;
  const estimatedFreeFloatMarketCapCr = NaN;
  const industry = String(
    industryInfo.basicIndustry ||
    industryInfo.industry ||
    metadata.industry ||
    info.industry ||
    ""
  );
  const sector = String(industryInfo.sector || "");
  const macro = String(industryInfo.macro || "");

  return {
    symbol: String(symbol || "").trim().toUpperCase(),
    companyName: String(info.companyName || ""),
    currentPrice,
    percentChange,
    previousClose,
    open,
    dayHigh,
    dayLow,
    vwap,
    week52Low: weekLow,
    week52LowDate: String(weekHighLow.minDate || ""),
    week52High: weekHigh,
    week52HighDate: String(weekHighLow.maxDate || ""),
    currentMarkerPrice: sliderValue,
    lastUpdateTime: String(metadata.lastUpdateTime || ""),
    industry,
    sector,
    macro,
    symbolPe: Number.isFinite(symbolPe) ? symbolPe : null,
    sectorPe: Number.isFinite(sectorPe) ? sectorPe : null,
    issuedSize: Number.isFinite(issuedSize) ? issuedSize : null,
    estimatedMarketCapCr: Number.isFinite(estimatedMarketCapCr) ? Number(estimatedMarketCapCr.toFixed(2)) : null,
    estimatedFreeFloatMarketCapCr: Number.isFinite(estimatedFreeFloatMarketCapCr) ? Number(estimatedFreeFloatMarketCapCr.toFixed(2)) : null
  };
}

async function buildStockDetails(symbol, days) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  if (!normalizedSymbol) {
    throw new Error("symbol is required");
  }

  const sessionCookie = await fetchNseSessionCookieHeader().catch(() => "");
  const quoteUrl = `${NSE_QUOTE_EQUITY_URL}?symbol=${encodeURIComponent(normalizedSymbol)}`;

  const [quoteResult, deliveryResult] = await Promise.allSettled([
    withTimeout(
      fetchNseJson(quoteUrl, sessionCookie, QUOTE_TIMEOUT_MS, "NSE quote request failed"),
      QUOTE_TIMEOUT_MS + 200,
      "stock quote request timeout"
    ),
    withTimeout(
      fetchDeliveryTrendForSymbol(normalizedSymbol, days),
      DELIVERY_FETCH_TIMEOUT_MS,
      "delivery trend request timeout"
    )
  ]);

  if (quoteResult.status !== "fulfilled") {
    throw new Error(quoteResult.reason?.message || "Failed to fetch stock quote");
  }

  const warnings = [];
  const deliveryTrend = deliveryResult.status === "fulfilled" ? deliveryResult.value : [];
  if (deliveryResult.status !== "fulfilled") {
    warnings.push(deliveryResult.reason?.message || "Delivery trend unavailable");
  }

  return {
    symbol: normalizedSymbol,
    quote: buildQuoteSummary(normalizedSymbol, quoteResult.value),
    deliveryTrend,
    deliveryTrendDays: deliveryTrend.length,
    requestedDeliveryTrendDays: days,
    warnings,
    source: {
      quote: "nse:quote-equity",
      deliveryTrend: "nse:bhavcopy-archives"
    }
  };
}

export async function GET(request) {
  const startedAt = Date.now();
  logStockDetailsRequest("request", request);
  const auth = await requireMarketAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const params = request.nextUrl.searchParams;
  const symbol = String(params.get("symbol") || "").trim().toUpperCase();
  const days = parsePositiveInt(params.get("days") || "15", 15, 15);

  if (!symbol) {
    logStockDetailsRequest("bad_request", request, { reason: "missing symbol" });
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }

  const cacheKey = `${symbol}:${days}`;
  const now = Date.now();
  const cached = detailsCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    logStockDetailsRequest("cache_hit", request, {
      symbol,
      days,
      durationMs: Date.now() - startedAt
    });
    return NextResponse.json(cached.payload, { status: 200 });
  }

  if (detailsInflight.has(cacheKey)) {
    try {
      const payload = await withTimeout(
        detailsInflight.get(cacheKey),
        DETAILS_REQUEST_BUDGET_MS,
        "stock details inflight timeout"
      );
      logStockDetailsRequest("inflight_hit", request, {
        symbol,
        days,
        durationMs: Date.now() - startedAt
      });
      return NextResponse.json(payload, { status: 200 });
    } catch (error) {
      const stale = findRecentDetailsCacheBySymbol(symbol);
      if (stale) {
        logStockDetailsRequest("stale_cache_hit", request, {
          symbol,
          days,
          durationMs: Date.now() - startedAt
        });
        return NextResponse.json(stale, { status: 200 });
      }
      const status = classifyStockDetailsError(error);
      const message = error?.message || "Failed to fetch stock details";
      logStockDetailsRequest("error", request, { status, message, symbol, days, durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: message }, { status });
    }
  }

  const promise = buildStockDetails(symbol, days)
    .then((payload) => {
      detailsCache.set(cacheKey, {
        payload,
        expiresAt: Date.now() + DETAILS_CACHE_TTL_MS
      });
      trimCaches(detailsCache, 128);
      return payload;
    })
    .finally(() => {
      detailsInflight.delete(cacheKey);
    });

  detailsInflight.set(cacheKey, promise);

  try {
    const payload = await withTimeout(promise, DETAILS_REQUEST_BUDGET_MS, "stock details request timeout");
    logStockDetailsRequest("success", request, {
      symbol,
      days,
      durationMs: Date.now() - startedAt,
      deliveryTrendDays: Array.isArray(payload?.deliveryTrend) ? payload.deliveryTrend.length : 0
    });
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    const stale = findRecentDetailsCacheBySymbol(symbol);
    if (stale) {
      logStockDetailsRequest("stale_cache_hit", request, {
        symbol,
        days,
        durationMs: Date.now() - startedAt
      });
      return NextResponse.json(stale, { status: 200 });
    }
    const status = classifyStockDetailsError(error);
    const message = error?.message || "Failed to fetch stock details";
    logStockDetailsRequest("error", request, { status, message, symbol, days, durationMs: Date.now() - startedAt });
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
