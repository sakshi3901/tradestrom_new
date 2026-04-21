"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Toaster, toast } from "react-hot-toast";
import ContributionTable from "@/components/niftyContribution/ContributionTable";
import NiftyChart from "@/components/niftyContribution/NiftyChart";
import RangeOptionsSection from "@/components/niftyContribution/RangeOptionsSection";
import TopMoverDetailsModal from "@/components/niftyContribution/TopMoverDetailsModal";
import {
  NIFTY_TIMEFRAME_OPTIONS,
  getNearestIndexTimestamp
} from "@/components/niftyContribution/ContributionEngine";

const CHART_TYPE_OPTIONS = [
  { value: "candlestick", label: "Candlestick" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" }
];

const INDEX_OPTIONS = [
  { value: "NIFTY50", label: "Nifty50" },
  { value: "NIFTY200", label: "FNO" },
  { value: "BANKNIFTY", label: "Nifty Bank" }
];

function asFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round(value, decimals = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
}

async function fetchJsonOrThrow(url, init = {}) {
  const {
    timeoutMs = 4000,
    signal: externalSignal,
    ...fetchInit
  } = init || {};
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }
  const timeoutId = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? setTimeout(() => controller.abort(), Number(timeoutMs))
    : null;

  try {
    const response = await fetch(url, {
      cache: "no-store",
      ...fetchInit,
      signal: controller.signal
    });

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new Error(payload?.error || `Request failed (${response.status})`);
    }

    return payload;
  } catch (error) {
    if (String(error?.name || "").toLowerCase() === "aborterror") {
      throw new Error("Request timeout");
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}

function showErrorToast(message, id = "nifty-contribution-error") {
  const text = String(message || "").trim();
  if (!text) {
    return;
  }
  toast.error(text, {
    id,
    duration: 4000
  });
}

function getTopMoverDetailsCacheKey(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function getIstNowDate() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

function isWeekendIST(istDate) {
  const day = istDate.getDay();
  return day === 0 || day === 6;
}

function getPreviousTradingDayIST(istDate) {
  const cursor = new Date(istDate);
  cursor.setHours(0, 0, 0, 0);
  do {
    cursor.setDate(cursor.getDate() - 1);
  } while (isWeekendIST(cursor));
  return cursor;
}

function getSessionRangeForIstDate(istDate, { clampToNow = false } = {}) {
  const year = istDate.getFullYear();
  const month = istDate.getMonth();
  const day = istDate.getDate();

  const sessionStartUtcMillis = Date.UTC(year, month, day, 3, 45, 0, 0); // 09:15 IST
  const sessionEndUtcMillis = Date.UTC(year, month, day, 10, 0, 0, 0); // 15:30 IST

  let sessionToUtcMillis = sessionEndUtcMillis;
  if (clampToNow) {
    sessionToUtcMillis = Math.min(Date.now(), sessionEndUtcMillis);
  }
  if (sessionToUtcMillis <= sessionStartUtcMillis) {
    sessionToUtcMillis = sessionStartUtcMillis + 60 * 1000;
  }

  return {
    from: Math.floor(sessionStartUtcMillis / 1000),
    to: Math.floor(sessionToUtcMillis / 1000),
    sessionDateKey: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    sessionIstDate: new Date(istDate)
  };
}

function getPreferredChartSessionRangeIST() {
  const istNow = getIstNowDate();
  const totalMinutes = (istNow.getHours() * 60) + istNow.getMinutes();
  const beforeSwitchTime = totalMinutes < (9 * 60 + 10); // 09:10 IST

  if (isWeekendIST(istNow) || beforeSwitchTime) {
    const previousTradingDay = getPreviousTradingDayIST(istNow);
    return {
      ...getSessionRangeForIstDate(previousTradingDay, { clampToNow: false }),
      sourceMode: "previous"
    };
  }

  return {
    ...getSessionRangeForIstDate(istNow, { clampToNow: true }),
    sourceMode: "current"
  };
}

function getCandidateSessionRanges(preferredRange, maxLookback = 10) {
  const ranges = [preferredRange];
  let cursor = new Date(preferredRange.sessionIstDate);
  for (let index = 0; index < maxLookback; index += 1) {
    cursor = getPreviousTradingDayIST(cursor);
    ranges.push({
      ...getSessionRangeForIstDate(cursor, { clampToNow: false }),
      sourceMode: "fallback"
    });
  }
  return ranges;
}

function isWithinMinuteRefreshWindowIST() {
  const istNow = getIstNowDate();
  if (isWeekendIST(istNow)) {
    return false;
  }
  const totalMinutes = (istNow.getHours() * 60) + istNow.getMinutes();
  return totalMinutes >= (9 * 60 + 10) && totalMinutes <= (15 * 60 + 45);
}

function getCurrentMinuteRefreshToken() {
  const istNow = getIstNowDate();
  return Math.floor(istNow.getTime() / 1000 / 60) * 60;
}

function getLatestClosedMinuteTimestampIST() {
  const istNow = getIstNowDate();
  const totalMinutes = (istNow.getHours() * 60) + istNow.getMinutes();
  const sessionOpenMinute = (9 * 60) + 15;
  const sessionSwitchMinute = (9 * 60) + 10;
  const sessionCloseMinute = (15 * 60) + 29;

  if (isWeekendIST(istNow) || totalMinutes < sessionSwitchMinute) {
    const previousTradingDay = getPreviousTradingDayIST(istNow);
    return getSessionRangeForIstDate(previousTradingDay, { clampToNow: false }).to;
  }

  if (totalMinutes > sessionCloseMinute) {
    return getSessionRangeForIstDate(istNow, { clampToNow: false }).to;
  }

  const currentMinute = Math.floor(istNow.getTime() / 1000 / 60) * 60;
  const closedMinute = currentMinute - 60;
  const sessionStartTimestamp = getSessionRangeForIstDate(istNow, { clampToNow: false }).from;
  if (!Number.isFinite(closedMinute) || closedMinute < sessionStartTimestamp) {
    const previousTradingDay = getPreviousTradingDayIST(istNow);
    return getSessionRangeForIstDate(previousTradingDay, { clampToNow: false }).to;
  }
  return closedMinute;
}

function getIntervalSeconds(interval) {
  const key = String(interval || "").toLowerCase().trim();
  if (key === "1m") {
    return 60;
  }
  if (key === "3m") {
    return 180;
  }
  if (key === "15m") {
    return 900;
  }
  return 60;
}

function getCurrentClosedMinuteCutoffUnix() {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return Math.floor(istNow.getTime() / 1000 / 60) * 60;
}

function aggregateCandlesByInterval(candles, intervalSeconds) {
  const source = Array.isArray(candles) ? candles : [];
  if (!source.length || !Number.isFinite(intervalSeconds) || intervalSeconds <= 60) {
    return source;
  }

  const output = [];
  let current = null;

  for (const candle of source) {
    const timestamp = asFiniteNumber(candle?.timestamp ?? candle?.time, NaN);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      continue;
    }

    const bucketTimestamp = Math.floor(timestamp / intervalSeconds) * intervalSeconds;
    const open = asFiniteNumber(candle?.open, 0);
    const high = asFiniteNumber(candle?.high, open);
    const low = asFiniteNumber(candle?.low, open);
    const close = asFiniteNumber(candle?.close, open);
    const volume = Math.round(asFiniteNumber(candle?.volume, 0));

    if (!current || current.timestamp !== bucketTimestamp) {
      if (current) {
        output.push({
          ...current,
          time: current.timestamp,
          open: round(current.open, 2),
          high: round(current.high, 2),
          low: round(current.low, 2),
          close: round(current.close, 2),
          volume: Math.round(current.volume)
        });
      }
      current = {
        timestamp: bucketTimestamp,
        open,
        high,
        low,
        close,
        volume
      };
      continue;
    }

    current.high = Math.max(current.high, high);
    current.low = Math.min(current.low, low);
    current.close = close;
    current.volume += volume;
  }

  if (current) {
    output.push({
      ...current,
      time: current.timestamp,
      open: round(current.open, 2),
      high: round(current.high, 2),
      low: round(current.low, 2),
      close: round(current.close, 2),
      volume: Math.round(current.volume)
    });
  }

  return output;
}

function adaptChartDatasetToTimeframe(baseDataset, timeframe) {
  if (!baseDataset?.indexCandles?.length) {
    return baseDataset || null;
  }

  const intervalSeconds = getIntervalSeconds(timeframe);
  if (intervalSeconds <= 60) {
    return {
      ...baseDataset,
      timeframe: "1m"
    };
  }

  const indexCandles = aggregateCandlesByInterval(baseDataset.indexCandles, intervalSeconds);
  const indexTimestamps = indexCandles.map((candle) => candle.timestamp);
  const indexByTimestamp = new Map(indexCandles.map((candle) => [candle.timestamp, candle]));

  return {
    ...baseDataset,
    timeframe: String(timeframe || "1m"),
    indexCandles,
    indexTimestamps,
    indexByTimestamp
  };
}

function adaptOhlcChartPayload(payload, timeframe) {
  const rawCandles = Array.isArray(payload?.candles) ? payload.candles : [];
  const intervalSeconds = getIntervalSeconds(payload?.interval || timeframe);
  const closedMinuteCutoff = getCurrentClosedMinuteCutoffUnix();
  const indexCandles = rawCandles
    .map((row) => {
      const timestamp = asFiniteNumber(row?.timestamp, NaN);
      if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return null;
      }
      return {
        timestamp,
        time: timestamp,
        open: round(asFiniteNumber(row?.open, 0), 2),
        high: round(asFiniteNumber(row?.high, 0), 2),
        low: round(asFiniteNumber(row?.low, 0), 2),
        close: round(asFiniteNumber(row?.close, 0), 2),
        volume: Math.round(asFiniteNumber(row?.volume, 0))
      };
    })
    .filter(Boolean)
    .filter((candle) => (Number(candle.timestamp) + intervalSeconds) <= closedMinuteCutoff)
    .sort((a, b) => a.timestamp - b.timestamp);

  const indexTimestamps = indexCandles.map((candle) => candle.timestamp);
  const indexByTimestamp = new Map(indexCandles.map((candle) => [candle.timestamp, candle]));

  return {
    kind: "ohlc",
    source: String(payload?.source || "zerodha"),
    symbol: String(payload?.symbol || ""),
    timeframe: String(payload?.interval || timeframe || "1m"),
    generatedAt: Math.floor(Date.now() / 1000),
    indexCandles,
    indexTimestamps,
    indexByTimestamp,
    sectors: []
  };
}

function computeSelectedChartSnapshot(dataset, selectedTimestamp) {
  if (!dataset?.indexCandles?.length) {
    return {
      selectedCandle: null,
      meta: null
    };
  }

  const resolvedTimestamp = getNearestIndexTimestamp(dataset, selectedTimestamp);
  const selectedIndex = dataset.indexTimestamps.indexOf(resolvedTimestamp);
  const selectedCandle = dataset.indexByTimestamp.get(resolvedTimestamp);
  if (!selectedCandle) {
    return {
      selectedCandle: null,
      meta: null
    };
  }

  const previousIndexCandle = selectedIndex > 0 ? dataset.indexCandles[selectedIndex - 1] : null;
  const previousClose = asFiniteNumber(previousIndexCandle?.close, asFiniteNumber(selectedCandle.open, 0));
  const pointChange = asFiniteNumber(selectedCandle.close, 0) - previousClose;
  const percentChange = previousClose > 0 ? ((asFiniteNumber(selectedCandle.close, 0) - previousClose) / previousClose) * 100 : 0;

  return {
    selectedCandle: {
      ...selectedCandle,
      previousClose: round(previousClose, 2),
      previousTimestamp: previousIndexCandle?.timestamp ?? null,
      pointChange: round(pointChange, 2),
      percentChange: round(percentChange, 4),
      candleNumber: selectedIndex + 1,
      totalCandles: dataset.indexCandles.length
    },
    meta: {
      resolvedTimestamp,
      selectedIndex
    }
  };
}

function mapMoverRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const metrics = row?.metrics && typeof row.metrics === "object" ? row.metrics : {};
    return {
      symbol: String(row?.symbol || "").toUpperCase(),
      pointToIndex: asFiniteNumber(metrics?.point_to_index, 0),
      perToIndex: asFiniteNumber(metrics?.per_to_index, 0),
      perChange: asFiniteNumber(metrics?.per_change, 0)
    };
  }).filter((row) => row.symbol);
}

function buildSingleExecuteTableStateFromMoverSnapshot({ snapshotPayload, chartDataset, selectedTimestamp }) {
  const resolvedExecuteTimestamp = asFiniteNumber(snapshotPayload?.timestamp, selectedTimestamp);
  const chartSnapshot = computeSelectedChartSnapshot(chartDataset, resolvedExecuteTimestamp);
  return {
    rows: mapMoverRows(snapshotPayload?.rows),
    selectedCandle: chartSnapshot.selectedCandle,
    validation: null,
    meta: {
      resolvedTimestamp: resolvedExecuteTimestamp
    },
    optionsRangeMeta: {
      startTimestamp: resolvedExecuteTimestamp,
      endTimestamp: resolvedExecuteTimestamp,
      candleCount: 1
    }
  };
}

function buildSingleOptionsPayloadFromSnapshot(snapshotPayload, selectedTimestamp) {
  if (!snapshotPayload || typeof snapshotPayload !== "object") {
    return null;
  }

  const strikes = Array.isArray(snapshotPayload?.strikes) ? snapshotPayload.strikes : [];
  let callOiTotal = 0;
  let putOiTotal = 0;

  for (const strike of strikes) {
    callOiTotal += asFiniteNumber(strike?.call?.oi, 0);
    putOiTotal += asFiniteNumber(strike?.put?.oi, 0);
  }

  const pcr = callOiTotal > 0 ? (putOiTotal / callOiTotal) : 0;
  const resolvedTimestamp = asFiniteNumber(snapshotPayload?.timestamp, selectedTimestamp || 0);

  return {
    startSnapshot: snapshotPayload,
    endSnapshot: snapshotPayload,
    latestSnapshot: snapshotPayload,
    ts1: {
      exactMatch: true,
      requestedTimestamp: selectedTimestamp,
      resolvedTimestamp,
      snapshot: snapshotPayload
    },
    ts2: {
      exactMatch: true,
      requestedTimestamp: selectedTimestamp,
      resolvedTimestamp,
      snapshot: snapshotPayload
    },
    selected: {
      callOiTotal,
      putOiTotal,
      pcr
    },
    netOiChange: {
      net: 0,
      pct: 0
    }
  };
}

function sumOptionSnapshotStrikeTotals(snapshotPayload) {
  const strikes = Array.isArray(snapshotPayload?.strikes) ? snapshotPayload.strikes : [];
  let callOiTotal = 0;
  let putOiTotal = 0;
  for (const strike of strikes) {
    callOiTotal += asFiniteNumber(strike?.call?.oi, 0);
    putOiTotal += asFiniteNumber(strike?.put?.oi, 0);
  }
  return {
    callOiTotal,
    putOiTotal,
    totalOi: callOiTotal + putOiTotal,
    pcr: callOiTotal > 0 ? (putOiTotal / callOiTotal) : 0
  };
}

function buildOptionSnapshotStrikeMap(snapshotPayload) {
  const output = new Map();
  const strikes = Array.isArray(snapshotPayload?.strikes) ? snapshotPayload.strikes : [];
  for (const strike of strikes) {
    const strikePrice = asFiniteNumber(strike?.strike, NaN);
    if (!Number.isFinite(strikePrice)) {
      continue;
    }
    output.set(String(strikePrice), {
      callOi: asFiniteNumber(strike?.call?.oi, 0),
      putOi: asFiniteNumber(strike?.put?.oi, 0)
    });
  }
  return output;
}

function buildHighestOiFromOptionSnapshot(snapshotPayload) {
  const strikes = Array.isArray(snapshotPayload?.strikes) ? snapshotPayload.strikes : [];
  let callStrike = 0;
  let callOI = 0;
  let putStrike = 0;
  let putOI = 0;

  for (const strike of strikes) {
    const strikePrice = asFiniteNumber(strike?.strike, 0);
    const currentCallOi = asFiniteNumber(strike?.call?.oi, 0);
    const currentPutOi = asFiniteNumber(strike?.put?.oi, 0);
    if (currentCallOi > callOI) {
      callOI = currentCallOi;
      callStrike = strikePrice;
    }
    if (currentPutOi > putOI) {
      putOI = currentPutOi;
      putStrike = strikePrice;
    }
  }

  const timestamp = asFiniteNumber(snapshotPayload?.timestamp, 0);
  return {
    callStrike,
    callOI,
    callTimestamp: timestamp,
    putStrike,
    putOI,
    putTimestamp: timestamp
  };
}

function buildRangeOptionsPayloadFromSnapshots(startSnapshotPayload, endSnapshotPayload, requestedStartTimestamp, requestedEndTimestamp) {
  if (!startSnapshotPayload || !endSnapshotPayload) {
    return null;
  }

  const startResolved = asFiniteNumber(startSnapshotPayload?.timestamp, requestedStartTimestamp || 0);
  const endResolved = asFiniteNumber(endSnapshotPayload?.timestamp, requestedEndTimestamp || 0);
  const startTotals = sumOptionSnapshotStrikeTotals(startSnapshotPayload);
  const endTotals = sumOptionSnapshotStrikeTotals(endSnapshotPayload);

  const startMap = buildOptionSnapshotStrikeMap(startSnapshotPayload);
  const endMap = buildOptionSnapshotStrikeMap(endSnapshotPayload);
  const commonKeys = [...startMap.keys()].filter((key) => endMap.has(key));

  let selectedCallOiTotal = 0;
  let selectedPutOiTotal = 0;
  for (const key of commonKeys) {
    const startRow = startMap.get(key);
    const endRow = endMap.get(key);
    selectedCallOiTotal += asFiniteNumber(endRow?.callOi, 0) - asFiniteNumber(startRow?.callOi, 0);
    selectedPutOiTotal += asFiniteNumber(endRow?.putOi, 0) - asFiniteNumber(startRow?.putOi, 0);
  }

  const selectedTotalOi = selectedCallOiTotal + selectedPutOiTotal;
  const selectedPcr = selectedCallOiTotal !== 0 ? (selectedPutOiTotal / selectedCallOiTotal) : 0;
  const net = endTotals.totalOi - startTotals.totalOi;
  const netPct = startTotals.totalOi !== 0 ? (net / startTotals.totalOi) * 100 : 0;

  return {
    symbol: String(endSnapshotPayload?.symbol || startSnapshotPayload?.symbol || "NIFTY"),
    source: String(endSnapshotPayload?.source || startSnapshotPayload?.source || "proxy:snapshot"),
    interval: String(endSnapshotPayload?.interval || startSnapshotPayload?.interval || "1m"),
    startTimestamp: requestedStartTimestamp,
    endTimestamp: requestedEndTimestamp,
    ts1: {
      requestTimestamp: requestedStartTimestamp,
      resolvedTimestamp: startResolved,
      exactMatch: startResolved === asFiniteNumber(requestedStartTimestamp, 0),
      snapshot: startSnapshotPayload
    },
    ts2: {
      requestTimestamp: requestedEndTimestamp,
      resolvedTimestamp: endResolved,
      exactMatch: endResolved === asFiniteNumber(requestedEndTimestamp, 0),
      snapshot: endSnapshotPayload
    },
    selected: {
      snapshotCount: 2,
      callOiTotal: Math.round(selectedCallOiTotal),
      putOiTotal: Math.round(selectedPutOiTotal),
      totalOi: Math.round(selectedTotalOi),
      pcr: Number.isFinite(selectedPcr) ? Number(selectedPcr.toFixed(2)) : 0
    },
    session: {
      snapshotCount: 1,
      callOiTotal: Math.round(endTotals.callOiTotal),
      putOiTotal: Math.round(endTotals.putOiTotal),
      totalOi: Math.round(endTotals.totalOi),
      pcr: Number.isFinite(endTotals.pcr) ? Number(endTotals.pcr.toFixed(4)) : 0,
      sessionStartTimestamp: asFiniteNumber(requestedStartTimestamp, startResolved),
      sessionLatestTimestamp: endResolved
    },
    netOiChange: {
      totalTs1: Number(startTotals.totalOi.toFixed(1)),
      totalTs2: Number(endTotals.totalOi.toFixed(1)),
      net: Number(net.toFixed(1)),
      pct: Number.isFinite(netPct) ? Number(netPct.toFixed(2)) : 0
    },
    highestOI: buildHighestOiFromOptionSnapshot(endSnapshotPayload),
    startSnapshot: startSnapshotPayload,
    endSnapshot: endSnapshotPayload,
    latestSnapshot: endSnapshotPayload
  };
}

function validateOptionLegCount(payload) {
  const expected = asFiniteNumber(payload?.expectedLegCount, 42);
  const ts1Count = asFiniteNumber(payload?.ts1?.chain?.legCount, NaN);
  const ts2Count = asFiniteNumber(payload?.ts2?.chain?.legCount, NaN);
  const singleLegCount = asFiniteNumber(payload?.legCount, NaN);
  const rawData = payload?.data && typeof payload.data === "object" ? payload.data : null;

  if (Number.isFinite(singleLegCount)) {
    return singleLegCount === expected;
  }
  if (rawData) {
    const values = Object.values(rawData);
    if (values.length > 0 && values.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      return values.every((item) => Object.keys(item).length === expected);
    }
    return Object.keys(rawData).length === expected;
  }

  if (!Number.isFinite(ts1Count) || !Number.isFinite(ts2Count)) {
    return false;
  }

  return ts1Count === expected && ts2Count === expected;
}

function parseStrikeFromOptionDataKey(key) {
  const upper = String(key || "").toUpperCase().trim();
  const match = upper.match(/(\d+)(CE|PE)$/);
  if (!match) {
    return { strike: 0, type: "" };
  }
  return {
    strike: asFiniteNumber(match[1], 0),
    type: String(match[2] || "")
  };
}

function normalizeTimestampKey(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function nearestTimestampEntry(entries, targetTs, fallbackIndex = 0) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }
  const target = asFiniteNumber(targetTs, 0);
  if (target <= 0) {
    return entries[Math.max(0, Math.min(entries.length - 1, fallbackIndex))];
  }
  let best = entries[0];
  let bestDistance = Math.abs(best.timestamp - target);
  for (const entry of entries.slice(1)) {
    const distance = Math.abs(entry.timestamp - target);
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
      continue;
    }
    if (distance === bestDistance && entry.timestamp > best.timestamp) {
      best = entry;
    }
  }
  return best;
}

function extractIndexAnalysisDataMaps(indexAnalysisPayload, startTimestamp, endTimestamp) {
  const rawData = indexAnalysisPayload?.data && typeof indexAnalysisPayload.data === "object"
    ? indexAnalysisPayload.data
    : null;
  if (!rawData) {
    return null;
  }

  const entries = Object.entries(rawData)
    .map(([rawTs, rawMap]) => ({
      timestamp: normalizeTimestampKey(rawTs),
      data: rawMap && typeof rawMap === "object" && !Array.isArray(rawMap) ? rawMap : {}
    }))
    .filter((entry) => entry.timestamp > 0)
    .sort((left, right) => left.timestamp - right.timestamp);

  if (entries.length === 0) {
    return null;
  }

  const ts1Entry = nearestTimestampEntry(entries, startTimestamp, 0) || entries[0];
  const ts2Entry = nearestTimestampEntry(entries, endTimestamp, entries.length - 1) || entries[entries.length - 1];
  return {
    ts1: ts1Entry,
    ts2: ts2Entry
  };
}

function computeRangeMetricsFromIndexDataMaps(ts1DataMap, ts2DataMap) {
  const ts1Map = ts1DataMap && typeof ts1DataMap === "object" ? ts1DataMap : {};
  const ts2Map = ts2DataMap && typeof ts2DataMap === "object" ? ts2DataMap : {};
  const ts1Keys = Object.keys(ts1Map);
  const ts2Keys = Object.keys(ts2Map);
  if (ts1Keys.length === 0 || ts2Keys.length === 0) {
    return null;
  }

  const commonKeys = ts1Keys.filter((key) => Object.prototype.hasOwnProperty.call(ts2Map, key));
  if (commonKeys.length === 0) {
    return null;
  }

  let totalTs1 = 0;
  let totalTs2 = 0;
  let selectedCall = 0;
  let selectedPut = 0;

  for (const key of commonKeys) {
    const left = asFiniteNumber(ts1Map[key], 0);
    const right = asFiniteNumber(ts2Map[key], 0);
    totalTs1 += left;
    totalTs2 += right;
    const diff = right - left;
    const upper = String(key || "").toUpperCase().trim();
    if (upper.endsWith("CE")) {
      selectedCall += diff;
      continue;
    }
    if (upper.endsWith("PE")) {
      selectedPut += diff;
    }
  }

  const net = totalTs2 - totalTs1;
  const netPct = totalTs1 !== 0 ? (net / totalTs1) * 100 : 0;
  const selectedTotal = selectedCall + selectedPut;
  const selectedPcr = selectedCall !== 0 ? (selectedPut / selectedCall) : 0;

  return {
    totalTs1,
    totalTs2,
    net,
    netPct,
    selectedCall,
    selectedPut,
    selectedTotal,
    selectedPcr
  };
}

function summarizeOptionDataMap(dataMap) {
  if (!dataMap || typeof dataMap !== "object") {
    return null;
  }

  let totalCallOi = 0;
  let totalPutOi = 0;
  let highestCallOi = 0;
  let highestPutOi = 0;
  let highestCallStrike = 0;
  let highestPutStrike = 0;

  for (const [key, valueRaw] of Object.entries(dataMap)) {
    const value = asFiniteNumber(valueRaw, NaN);
    if (!Number.isFinite(value)) {
      continue;
    }
    const parsed = parseStrikeFromOptionDataKey(key);
    if (parsed.type === "CE") {
      totalCallOi += value;
      if (value > highestCallOi) {
        highestCallOi = value;
        highestCallStrike = parsed.strike;
      }
      continue;
    }
    if (parsed.type === "PE") {
      totalPutOi += value;
      if (value > highestPutOi) {
        highestPutOi = value;
        highestPutStrike = parsed.strike;
      }
    }
  }

  const totalOi = totalCallOi + totalPutOi;
  const pcr = totalCallOi > 0 ? (totalPutOi / totalCallOi) : 0;
  return {
    totalCallOi,
    totalPutOi,
    totalOi,
    pcr,
    highestCallOi,
    highestPutOi,
    highestCallStrike,
    highestPutStrike
  };
}

function buildOptionMetricsFromLiveData(liveOiPayload, fallbackTimestamp = 0) {
  const dataMap = liveOiPayload?.data && typeof liveOiPayload.data === "object" ? liveOiPayload.data : null;
  const summary = summarizeOptionDataMap(dataMap);
  if (!summary) {
    return null;
  }

  const timestamp = asFiniteNumber(
    liveOiPayload?.resolvedTimestamp,
    asFiniteNumber(liveOiPayload?.requestTimestamp, asFiniteNumber(fallbackTimestamp, 0))
  );
  const latestSnapshot = {
    timestamp,
    data: { ...dataMap },
    underlying: 0
  };

  return {
    symbol: "NIFTY",
    source: "live_oi",
    interval: "1m",
    startTimestamp: timestamp,
    endTimestamp: timestamp,
    selected: {
      snapshotCount: 1,
      callOiTotal: Math.round(summary.totalCallOi),
      putOiTotal: Math.round(summary.totalPutOi),
      totalOi: Math.round(summary.totalOi),
      pcr: Number(summary.pcr.toFixed(2))
    },
    session: {
      snapshotCount: 1,
      callOiTotal: Math.round(summary.totalCallOi),
      putOiTotal: Math.round(summary.totalPutOi),
      totalOi: Math.round(summary.totalOi),
      pcr: Number(summary.pcr.toFixed(4)),
      sessionStartTimestamp: timestamp,
      sessionLatestTimestamp: timestamp
    },
    netOiChange: {
      totalTs1: 0,
      totalTs2: 0,
      net: 0,
      pct: 0
    },
    highestOI: {
      callStrike: summary.highestCallStrike,
      callOI: summary.highestCallOi,
      callTimestamp: timestamp,
      putStrike: summary.highestPutStrike,
      putOI: summary.highestPutOi,
      putTimestamp: timestamp
    },
    latestSnapshot
  };
}

function mergeOptionMetricsWithLive(indexAnalysisPayload, liveOiPayload, fallbackStartTimestamp = 0, fallbackEndTimestamp = 0) {
  if (!liveOiPayload || typeof liveOiPayload !== "object") {
    return indexAnalysisPayload;
  }

  const dataMap = liveOiPayload?.data && typeof liveOiPayload.data === "object" ? liveOiPayload.data : null;
  const summary = summarizeOptionDataMap(dataMap);
  if (!summary) {
    return indexAnalysisPayload || null;
  }

  const indexDataMaps = extractIndexAnalysisDataMaps(indexAnalysisPayload, fallbackStartTimestamp, fallbackEndTimestamp);
  const rangeMetrics = indexDataMaps
    ? computeRangeMetricsFromIndexDataMaps(indexDataMaps.ts1.data, indexDataMaps.ts2.data)
    : null;

  const resolvedStartTimestamp = asFiniteNumber(
    indexDataMaps?.ts1?.timestamp,
    asFiniteNumber(fallbackStartTimestamp, asFiniteNumber(fallbackEndTimestamp, 0))
  );
  const resolvedEndTimestamp = asFiniteNumber(
    indexDataMaps?.ts2?.timestamp,
    asFiniteNumber(fallbackEndTimestamp, resolvedStartTimestamp)
  );

  const base = buildOptionMetricsFromLiveData(liveOiPayload, resolvedEndTimestamp);
  if (!base || typeof base !== "object") {
    return null;
  }

  const existingLatest = base?.latestSnapshot && typeof base.latestSnapshot === "object"
    ? base.latestSnapshot
    : base?.endSnapshot && typeof base.endSnapshot === "object"
      ? base.endSnapshot
      : null;
  const latestTimestamp = asFiniteNumber(
    liveOiPayload?.resolvedTimestamp,
    asFiniteNumber(existingLatest?.timestamp, resolvedEndTimestamp)
  );
  const latestSnapshot = {
    ...(existingLatest || {}),
    timestamp: latestTimestamp,
    data: { ...dataMap }
  };

  return {
    ...base,
    data: indexAnalysisPayload?.data && typeof indexAnalysisPayload.data === "object"
      ? { ...indexAnalysisPayload.data }
      : {},
    startTimestamp: resolvedStartTimestamp,
    endTimestamp: resolvedEndTimestamp,
    ts1: {
      requestTimestamp: resolvedStartTimestamp,
      resolvedTimestamp: resolvedStartTimestamp,
      exactMatch: true
    },
    ts2: {
      requestTimestamp: resolvedEndTimestamp,
      resolvedTimestamp: resolvedEndTimestamp,
      exactMatch: true
    },
    selected: rangeMetrics
      ? {
        snapshotCount: indexDataMaps && indexDataMaps.ts1.timestamp !== indexDataMaps.ts2.timestamp ? 2 : 1,
        callOiTotal: Math.round(rangeMetrics.selectedCall),
        putOiTotal: Math.round(rangeMetrics.selectedPut),
        totalOi: Math.round(rangeMetrics.selectedTotal),
        pcr: Number(rangeMetrics.selectedPcr.toFixed(2))
      }
      : base.selected,
    netOiChange: rangeMetrics
      ? {
        totalTs1: Number(rangeMetrics.totalTs1.toFixed(1)),
        totalTs2: Number(rangeMetrics.totalTs2.toFixed(1)),
        net: Number(rangeMetrics.net.toFixed(1)),
        pct: Number(rangeMetrics.netPct.toFixed(2))
      }
      : base.netOiChange,
    latestSnapshot,
    source: String(base?.source || "live_oi"),
    interval: String(base?.interval || "1m"),
    session: {
      ...(base?.session || {}),
      callOiTotal: Math.round(summary.totalCallOi),
      putOiTotal: Math.round(summary.totalPutOi),
      totalOi: Math.round(summary.totalOi),
      pcr: Number(summary.pcr.toFixed(4))
    },
    highestOI: {
      ...(base?.highestOI || {}),
      callStrike: summary.highestCallStrike,
      callOI: summary.highestCallOi,
      callTimestamp: latestTimestamp,
      putStrike: summary.highestPutStrike,
      putOI: summary.highestPutOi,
      putTimestamp: latestTimestamp
    }
  };
}

function buildFrozenLatestCardsFromOptionSnapshot(snapshotPayload) {
  if (!snapshotPayload || typeof snapshotPayload !== "object") {
    return null;
  }

  const strikes = Array.isArray(snapshotPayload?.strikes) ? snapshotPayload.strikes : [];
  if (!strikes.length) {
    return null;
  }

  let totalCallOi = 0;
  let totalPutOi = 0;
  let highestCallOi = 0;
  let highestPutOi = 0;
  let highestCallStrike = 0;
  let highestPutStrike = 0;

  for (const strike of strikes) {
    const strikePrice = asFiniteNumber(strike?.strike, 0);
    const callOi = asFiniteNumber(strike?.call?.oi, 0);
    const putOi = asFiniteNumber(strike?.put?.oi, 0);

    totalCallOi += callOi;
    totalPutOi += putOi;

    if (callOi > highestCallOi) {
      highestCallOi = callOi;
      highestCallStrike = strikePrice;
    }
    if (putOi > highestPutOi) {
      highestPutOi = putOi;
      highestPutStrike = strikePrice;
    }
  }

  return {
    timestamp: asFiniteNumber(snapshotPayload?.timestamp, 0),
    summaryOi: totalCallOi + totalPutOi,
    summaryPcr: totalCallOi > 0 ? (totalPutOi / totalCallOi) : 0,
    highestCallOi,
    highestPutOi,
    highestCallStrike,
    highestPutStrike
  };
}

function buildRangeDiffTableStateFromMoverSnapshots({ startSnapshotPayload, endSnapshotPayload, dataset, rangeMeta }) {
  const startTimestamp = asFiniteNumber(startSnapshotPayload?.timestamp, asFiniteNumber(rangeMeta?.startTimestamp, 0));
  const endTimestamp = asFiniteNumber(endSnapshotPayload?.timestamp, asFiniteNumber(rangeMeta?.endTimestamp, 0));
  const startRows = mapMoverRows(startSnapshotPayload?.rows);
  const endRows = mapMoverRows(endSnapshotPayload?.rows);
  const startBySymbol = new Map(startRows.map((row) => [row.symbol, row]));
  const endBySymbol = new Map(endRows.map((row) => [row.symbol, row]));
  const symbols = Array.from(new Set([...startBySymbol.keys(), ...endBySymbol.keys()])).sort((a, b) => a.localeCompare(b));

  const rows = symbols.map((symbol) => {
    const left = startBySymbol.get(symbol);
    const right = endBySymbol.get(symbol);
    return {
      symbol,
      perChange: asFiniteNumber(right?.perChange, 0) - asFiniteNumber(left?.perChange, 0),
      perToIndex: asFiniteNumber(right?.perToIndex, 0) - asFiniteNumber(left?.perToIndex, 0),
      pointToIndex: asFiniteNumber(right?.pointToIndex, 0) - asFiniteNumber(left?.pointToIndex, 0)
    };
  });

  const startChartCandleTs = Number.isFinite(startTimestamp) && dataset?.indexTimestamps?.length
    ? getNearestIndexTimestamp(dataset, startTimestamp)
    : startTimestamp;
  const endChartCandleTs = Number.isFinite(endTimestamp) && dataset?.indexTimestamps?.length
    ? getNearestIndexTimestamp(dataset, endTimestamp)
    : endTimestamp;
  const startIndexCandle = dataset?.indexByTimestamp?.get?.(startChartCandleTs) || null;
  const endIndexCandle = dataset?.indexByTimestamp?.get?.(endChartCandleTs) || null;
  const startClose = asFiniteNumber(startIndexCandle?.close, asFiniteNumber(startIndexCandle?.open, 0));
  const endClose = asFiniteNumber(endIndexCandle?.close, asFiniteNumber(endIndexCandle?.open, 0));
  const indexPointChange = endClose - startClose;
  const indexPercentChange = startClose > 0 ? ((endClose - startClose) / startClose) * 100 : 0;

  return {
    rows,
    selectedCandle: {
      timestamp: endChartCandleTs || endTimestamp || null,
      previousClose: round(startClose, 2),
      close: round(endClose, 2),
      pointChange: round(indexPointChange, 2),
      percentChange: round(indexPercentChange, 4)
    },
    validation: null,
    meta: {
      ts1Timestamp: startTimestamp || null,
      ts2Timestamp: endTimestamp || null,
      startTimestamp: startTimestamp || null,
      endTimestamp: endTimestamp || null,
      candleCount: Number(rangeMeta?.count) || 0
    }
  };
}

export default function NiftyContributionDashboard() {
  const [timeframe, setTimeframe] = useState("3m");
  const [selectionMode, setSelectionMode] = useState("range");
  const [chartType, setChartType] = useState("candlestick");
  const [selectedIndex, setSelectedIndex] = useState("NIFTY50");
  const [selectedTimestamp, setSelectedTimestamp] = useState(null);
  const [isPending, startTransition] = useTransition();
  const [liveState, setLiveState] = useState({
    status: "idle",
    dataset: null,
    error: ""
  });
  const [rangeSelection, setRangeSelection] = useState(null);
  const [rangeExecution, setRangeExecution] = useState({
    status: "idle",
    data: null,
    error: ""
  });
  const [singleExecution, setSingleExecution] = useState({
    status: "idle",
    data: null,
    error: ""
  });
  const [minuteRefreshToken, setMinuteRefreshToken] = useState(() => getCurrentMinuteRefreshToken());
  const [topMoverDetails, setTopMoverDetails] = useState({
    open: false,
    symbol: "",
    row: null,
    status: "idle",
    data: null,
    error: ""
  });
  const topMoverDetailsCacheRef = useRef(new Map());
  const topMoverDetailsRequestSeqRef = useRef(0);
  const topMoverDetailsAbortRef = useRef(null);
  const executeAbortRef = useRef(null);

  useEffect(() => () => {
    if (topMoverDetailsAbortRef.current) {
      topMoverDetailsAbortRef.current.abort();
      topMoverDetailsAbortRef.current = null;
    }
    if (executeAbortRef.current) {
      executeAbortRef.current.abort();
      executeAbortRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timerId = null;

    const scheduleNextTick = () => {
      if (cancelled) {
        return;
      }
      const nowMs = Date.now();
      const nextMinuteBoundaryMs = (Math.floor(nowMs / 60000) + 1) * 60000;
      const delayMs = Math.max(50, (nextMinuteBoundaryMs - nowMs) + 80);

      timerId = setTimeout(() => {
        if (cancelled) {
          return;
        }
        if (isWithinMinuteRefreshWindowIST()) {
          setMinuteRefreshToken(getCurrentMinuteRefreshToken());
        }
        scheduleNextTick();
      }, delayMs);
    };

    scheduleNextTick();

    return () => {
      cancelled = true;
      if (timerId) {
        clearTimeout(timerId);
      }
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    setLiveState((previous) => ({
      status: "loading",
      dataset: previous.dataset ?? null,
      error: ""
    }));

    const loadLiveData = async () => {
      try {
        const fetchOhlcRange = async ({ from, to }) => {
          const response = await fetch(
            `/api/ohlc?symbol=${encodeURIComponent(selectedIndex)}&interval=1m&from=${encodeURIComponent(String(from))}&to=${encodeURIComponent(String(to))}`,
            {
              method: "GET",
              cache: "no-store",
              signal: controller.signal
            }
          );

          const text = await response.text();
          let payload = null;
          try {
            payload = text ? JSON.parse(text) : null;
          } catch {
            payload = null;
          }

          if (!response.ok) {
            const error = new Error(payload?.error || `Failed to fetch chart data (${response.status})`);
            error.status = response.status;
            throw error;
          }

          return payload;
        };

        const preferredRange = getPreferredChartSessionRangeIST();
        const candidateRanges = getCandidateSessionRanges(preferredRange, 10);
        let finalDataset = null;
        let lastError = null;

        for (const range of candidateRanges) {
          if (controller.signal.aborted) {
            return;
          }

          try {
            const payload = await fetchOhlcRange(range);
            const adapted = adaptOhlcChartPayload(payload, "1m");
            if (adapted?.indexCandles?.length) {
              finalDataset = adapted;
              break;
            }
            lastError = new Error(`No OHLC candles found for ${range.sessionDateKey}`);
          } catch (error) {
            const message = String(error?.message || "").toLowerCase();
            const status = Number(error?.status);
            const isNoDataError = status === 404 || message.includes("no candles") || message.includes("empty");
            if (isNoDataError) {
              lastError = error;
              continue;
            }
            throw error;
          }
        }

        if (!finalDataset) {
          throw (lastError || new Error("Live OHLC payload is empty for the selected timeframe"));
        }

        setLiveState({
          status: "ready",
          dataset: finalDataset,
          error: ""
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setLiveState((previous) => ({
          status: "error",
          dataset: previous.dataset ?? null,
          error: error?.message || "Failed to load live chart data"
        }));
        showErrorToast(error?.message || "Failed to load live chart data", "nifty-chart-load");
      }
    };

    loadLiveData();

    return () => {
      controller.abort();
    };
  }, [selectedIndex, minuteRefreshToken]);

  const dataset = useMemo(
    () => adaptChartDatasetToTimeframe(liveState.dataset, timeframe),
    [liveState.dataset, timeframe]
  );

  useEffect(() => {
    setRangeExecution({
      status: "idle",
      data: null,
      error: ""
    });
    setSingleExecution({
      status: "idle",
      data: null,
      error: ""
    });
    setTopMoverDetails((previous) => ({
      ...previous,
      open: false
    }));
  }, [selectedIndex]);

  useEffect(() => {
    if (!dataset?.indexTimestamps?.length) {
      return;
    }

    if (!Number.isFinite(selectedTimestamp)) {
      setSelectedTimestamp(dataset.indexTimestamps[0] ?? null);
      return;
    }

    if (!dataset.indexByTimestamp.has(selectedTimestamp)) {
      setSelectedTimestamp(getNearestIndexTimestamp(dataset, selectedTimestamp));
    }
  }, [dataset, selectedTimestamp]);

  const snapshot = useMemo(
    () => computeSelectedChartSnapshot(dataset, selectedTimestamp),
    [dataset, selectedTimestamp]
  );

  const handleTimeframeChange = (nextTimeframe) => {
    if (!nextTimeframe || nextTimeframe === timeframe) {
      return;
    }

    startTransition(() => {
      setTimeframe(nextTimeframe);
    });
  };

  const handleSelectTimestamp = (timestamp) => {
    if (!Number.isFinite(timestamp)) {
      return;
    }
    setSelectedTimestamp((previous) => (previous === timestamp ? previous : timestamp));
  };

  const handleChartTypeChange = useCallback((nextType) => {
    if (!nextType) {
      return;
    }
    const exists = CHART_TYPE_OPTIONS.some((option) => option.value === nextType);
    if (exists) {
      setChartType(nextType);
    }
  }, []);

  const handleIndexChange = useCallback((nextIndex) => {
    const option = INDEX_OPTIONS.find((item) => item.value === nextIndex);
    if (!option || option.disabled) {
      return;
    }
    setSelectedIndex(nextIndex);
    setRangeExecution({
      status: "idle",
      data: null,
      error: ""
    });
    setSingleExecution({
      status: "idle",
      data: null,
      error: ""
    });
  }, []);

  const handleRangeSelectionChange = useCallback((nextRangeSelection) => {
    setRangeSelection(nextRangeSelection);
  }, []);

  const handleSelectionModeChange = useCallback((nextMode) => {
    const normalizedMode = nextMode === "range" ? "range" : "single";
    setSelectionMode(normalizedMode);
    if (normalizedMode === "single") {
      const firstTimestamp = Number(dataset?.indexTimestamps?.[0]);
      if (Number.isFinite(firstTimestamp) && firstTimestamp > 0) {
        setSelectedTimestamp(firstTimestamp);
      }
    }
  }, [dataset?.indexTimestamps]);

  const handleExecuteSingle = useCallback(async () => {
    const currentTimestamp = Number(selectedTimestamp);
    if (!Number.isFinite(currentTimestamp) || currentTimestamp <= 0) {
      showErrorToast("Select a valid candle before executing.", "nifty-execute-single");
      setSingleExecution({
        status: "error",
        data: null,
        error: "Hover a valid candle before executing."
      });
      return;
    }

    setSingleExecution((previous) => ({
      status: "loading",
      data: previous.data,
      error: ""
    }));

    if (executeAbortRef.current) {
      executeAbortRef.current.abort();
    }
    const controller = new AbortController();
    executeAbortRef.current = controller;

    try {
      const allTimestamps = Array.isArray(dataset?.indexTimestamps)
        ? dataset.indexTimestamps.filter((ts) => Number.isFinite(Number(ts)))
        : [];
      const resolvedSelectedTimestamp = allTimestamps.length
        ? getNearestIndexTimestamp(dataset, currentTimestamp)
        : currentTimestamp;

      const [moversSnapshotResult, liveOiResult, indexAnalysisResult] = await Promise.allSettled([
        fetchJsonOrThrow(
          `/api/movers/snapshot?index=${encodeURIComponent(selectedIndex)}&interval=1m&ts=${encodeURIComponent(String(resolvedSelectedTimestamp))}&limit=20&allow_fallback=1`,
          { method: "GET", signal: controller.signal, timeoutMs: 2400 }
        ),
        fetchJsonOrThrow(
          `/api/options/live_oi?symbol=NIFTY&ts=${encodeURIComponent(String(getLatestClosedMinuteTimestampIST()))}`,
          { method: "GET", signal: controller.signal, timeoutMs: 11000 }
        ),
        fetchJsonOrThrow(
          "/api/options/index_analysis",
          {
            method: "POST",
            signal: controller.signal,
            timeoutMs: 11000,
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              symbol: "NIFTY",
              startTimestamp: resolvedSelectedTimestamp,
              endTimestamp: resolvedSelectedTimestamp
            })
          }
        ),
      ]);

      if (moversSnapshotResult.status !== "fulfilled") {
        throw new Error(moversSnapshotResult.reason?.message || "Top movers snapshot unavailable");
      }

      const computed = buildSingleExecuteTableStateFromMoverSnapshot({
        snapshotPayload: moversSnapshotResult.value,
        chartDataset: dataset,
        selectedTimestamp: resolvedSelectedTimestamp
      });

      const optionWarnings = [];
      const liveOiPayload = liveOiResult.status === "fulfilled" ? (liveOiResult.value || null) : null;
      const indexAnalysisPayload = indexAnalysisResult.status === "fulfilled" ? (indexAnalysisResult.value || null) : null;
      const marketOverview = null;

      if (liveOiResult.status !== "fulfilled") {
        const message = `Live OI: ${liveOiResult.reason?.message || "latest option chain unavailable"}`;
        optionWarnings.push(message);
        showErrorToast(message, "nifty-options-live-oi");
      }

      if (indexAnalysisResult.status !== "fulfilled") {
        const message = `Index Analysis: ${indexAnalysisResult.reason?.message || "selected timestamp analysis unavailable"}`;
        optionWarnings.push(message);
        showErrorToast(message, "nifty-options-index-analysis-single");
      }

      if (liveOiPayload && !validateOptionLegCount(liveOiPayload)) {
        optionWarnings.push("Live OI payload does not contain expected 42 option legs (ATM±10)");
      }
      if (indexAnalysisPayload && !validateOptionLegCount(indexAnalysisPayload)) {
        optionWarnings.push("Index analysis payload does not contain expected 42 option legs (ATM±10)");
      }

      const nextOptionMetrics = mergeOptionMetricsWithLive(
        indexAnalysisPayload,
        liveOiPayload,
        resolvedSelectedTimestamp,
        resolvedSelectedTimestamp
      );

      setSingleExecution((previous) => {
        const preservedOptionMetrics = previous?.data?.options?.optionMetrics || null;
        return {
          status: "ready",
          data: {
            ...computed,
            options: {
              optionMetrics: nextOptionMetrics || preservedOptionMetrics,
              marketOverview,
              frozenLatestCards: null,
              warning: optionWarnings.join(" | ")
            },
            optionsRangeMeta: {
              startTimestamp: resolvedSelectedTimestamp,
              endTimestamp: resolvedSelectedTimestamp,
              candleCount: 1
            }
          },
          error: ""
        };
      });
    } catch (error) {
      if (controller.signal.aborted || String(error?.name || "").toLowerCase() === "aborterror") {
        return;
      }
      showErrorToast(error?.message || "Failed to execute selected candle analysis", "nifty-execute-single");
      setSingleExecution((previous) => ({
        status: previous.data ? "ready" : "error",
        data: previous.data ?? null,
        error: previous.data ? "" : (error?.message || "Failed to execute selected candle analysis")
      }));
    } finally {
      if (executeAbortRef.current === controller) {
        executeAbortRef.current = null;
      }
    }
  }, [dataset, selectedTimestamp, selectedIndex, timeframe]);

  const handleExecuteRange = useCallback(async () => {
    const startTimestamp = Number(rangeSelection?.startTimestamp);
    const endTimestamp = Number(rangeSelection?.endTimestamp);
    if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp) || endTimestamp <= startTimestamp) {
      showErrorToast("Select a valid chart range before executing.", "nifty-execute-range");
      setRangeExecution({
        status: "error",
        data: null,
        error: "Select a valid chart range before executing."
      });
      return;
    }

    setRangeExecution((previous) => ({
      status: "loading",
      data: previous.data,
      error: ""
    }));

    if (executeAbortRef.current) {
      executeAbortRef.current.abort();
    }
    const controller = new AbortController();
    executeAbortRef.current = controller;

    try {
      const allTimestamps = Array.isArray(dataset?.indexTimestamps)
        ? dataset.indexTimestamps.filter((ts) => Number.isFinite(Number(ts)))
        : [];
      const resolvedStartTimestamp = allTimestamps.length
        ? getNearestIndexTimestamp(dataset, startTimestamp)
        : startTimestamp;
      const resolvedEndTimestamp = allTimestamps.length
        ? getNearestIndexTimestamp(dataset, endTimestamp)
        : endTimestamp;
      const [startMoversResult, endMoversResult, liveOiResult, indexAnalysisResult] = await Promise.allSettled([
        fetchJsonOrThrow(
          `/api/movers/snapshot?index=${encodeURIComponent(selectedIndex)}&interval=1m&ts=${encodeURIComponent(String(resolvedStartTimestamp))}&limit=20&allow_fallback=1`,
          { method: "GET", signal: controller.signal, timeoutMs: 2400 }
        ),
        fetchJsonOrThrow(
          `/api/movers/snapshot?index=${encodeURIComponent(selectedIndex)}&interval=1m&ts=${encodeURIComponent(String(resolvedEndTimestamp))}&limit=20&allow_fallback=1`,
          { method: "GET", signal: controller.signal, timeoutMs: 2400 }
        ),
        fetchJsonOrThrow(
          `/api/options/live_oi?symbol=NIFTY&ts=${encodeURIComponent(String(getLatestClosedMinuteTimestampIST()))}`,
          { method: "GET", signal: controller.signal, timeoutMs: 11000 }
        ),
        fetchJsonOrThrow("/api/options/index_analysis", {
          method: "POST",
          signal: controller.signal,
          timeoutMs: 11000,
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            symbol: "NIFTY",
            startTimestamp: resolvedStartTimestamp,
            endTimestamp: resolvedEndTimestamp
          })
        })
      ]);

      if (startMoversResult.status !== "fulfilled") {
        throw new Error(startMoversResult.reason?.message || "TS1 top movers snapshot unavailable");
      }
      if (endMoversResult.status !== "fulfilled") {
        throw new Error(endMoversResult.reason?.message || "TS2 top movers snapshot unavailable");
      }

      const computed = buildRangeDiffTableStateFromMoverSnapshots({
        startSnapshotPayload: startMoversResult.value,
        endSnapshotPayload: endMoversResult.value,
        dataset,
        rangeMeta: {
          ...(rangeSelection || {}),
          startTimestamp: resolvedStartTimestamp,
          endTimestamp: resolvedEndTimestamp
        }
      });

      const optionWarnings = [];
      const liveOiPayload = liveOiResult.status === "fulfilled" ? (liveOiResult.value || null) : null;
      const indexAnalysisPayload = indexAnalysisResult.status === "fulfilled" ? (indexAnalysisResult.value || null) : null;
      const marketOverview = null;

      if (liveOiResult.status !== "fulfilled") {
        const message = `Live OI: ${liveOiResult.reason?.message || "latest option chain unavailable"}`;
        optionWarnings.push(message);
        showErrorToast(message, "nifty-options-live-oi");
      }
      if (indexAnalysisResult.status !== "fulfilled") {
        const message = `Index Analysis: ${indexAnalysisResult.reason?.message || "range option chain analysis unavailable"}`;
        optionWarnings.push(message);
        showErrorToast(message, "nifty-options-index-analysis-range");
      }
      if (liveOiPayload && !validateOptionLegCount(liveOiPayload)) {
        optionWarnings.push("Live OI payload does not contain expected 42 option legs (ATM±10)");
      }
      if (indexAnalysisPayload && !validateOptionLegCount(indexAnalysisPayload)) {
        optionWarnings.push("Index analysis payload does not contain expected 42 option legs (ATM±10)");
      }

      const hasIndexAnalysisSnapshot = Boolean(
        indexAnalysisPayload?.data
        && typeof indexAnalysisPayload.data === "object"
        && Object.keys(indexAnalysisPayload.data).length > 0
      );
      const nextOptionMetrics = mergeOptionMetricsWithLive(
        hasIndexAnalysisSnapshot ? indexAnalysisPayload : null,
        liveOiPayload,
        resolvedStartTimestamp,
        resolvedEndTimestamp
      );

      if (nextOptionMetrics) {
        const ts1Exact = Boolean(nextOptionMetrics?.ts1?.exactMatch);
        const ts2Exact = Boolean(nextOptionMetrics?.ts2?.exactMatch);
        const ts1Resolved = asFiniteNumber(nextOptionMetrics?.ts1?.resolvedTimestamp, 0);
        const ts2Resolved = asFiniteNumber(nextOptionMetrics?.ts2?.resolvedTimestamp, 0);
        if (!ts1Exact || !ts2Exact) {
          optionWarnings.push("Options TS1/TS2 exact snapshots unavailable (using nearest captured snapshots)");
        }
        if (ts1Resolved > 0 && ts2Resolved > 0 && ts1Resolved === ts2Resolved) {
          optionWarnings.push("Options TS1 and TS2 resolved to the same snapshot");
        }
      }

      setRangeExecution((previous) => {
        const preservedOptionMetrics = previous?.data?.options?.optionMetrics || null;
        return {
          status: "ready",
          data: {
            ...computed,
            options: {
              optionMetrics: nextOptionMetrics || preservedOptionMetrics,
              marketOverview,
              frozenLatestCards: null,
              warning: optionWarnings.join(" | ")
            }
          },
          error: ""
        };
      });
    } catch (error) {
      if (controller.signal.aborted || String(error?.name || "").toLowerCase() === "aborterror") {
        return;
      }
      showErrorToast(error?.message || "Failed to execute range contribution diff", "nifty-execute-range");
      setRangeExecution((previous) => ({
        status: previous.data ? "ready" : "error",
        data: previous.data ?? null,
        error: previous.data ? "" : (error?.message || "Failed to execute range contribution diff")
      }));
    } finally {
      if (executeAbortRef.current === controller) {
        executeAbortRef.current = null;
      }
    }
  }, [dataset, rangeSelection, selectedIndex, timeframe]);

  const handleExecuteSelection = useCallback(async () => {
    if (selectionMode === "range") {
      await handleExecuteRange();
      return;
    }
    await handleExecuteSingle();
  }, [handleExecuteRange, handleExecuteSingle, selectionMode]);

  const handleCloseTopMoverDetails = useCallback(() => {
    setTopMoverDetails((previous) => ({
      ...previous,
      open: false
    }));
  }, []);

  const handleTopMoverRowClick = useCallback(async (row) => {
    const symbol = String(row?.symbol || "").trim().toUpperCase();
    if (!symbol) {
      return;
    }

    const cacheKey = getTopMoverDetailsCacheKey(symbol);
    const cached = topMoverDetailsCacheRef.current.get(cacheKey);
    if (cached) {
      setTopMoverDetails({
        open: true,
        symbol,
        row,
        status: "ready",
        data: cached,
        error: ""
      });
      return;
    }

    const requestSeq = topMoverDetailsRequestSeqRef.current + 1;
    topMoverDetailsRequestSeqRef.current = requestSeq;
    if (topMoverDetailsAbortRef.current) {
      topMoverDetailsAbortRef.current.abort();
    }
    const controller = new AbortController();
    topMoverDetailsAbortRef.current = controller;

    setTopMoverDetails({
      open: true,
      symbol,
      row,
      status: "loading",
      data: null,
      error: ""
    });

    try {
      const payload = await fetchJsonOrThrow(
        `/api/stock/details?symbol=${encodeURIComponent(symbol)}&days=15`,
        { method: "GET", signal: controller.signal, timeoutMs: 2200 }
      );

      topMoverDetailsCacheRef.current.set(cacheKey, payload);

      if (topMoverDetailsRequestSeqRef.current !== requestSeq) {
        return;
      }

      setTopMoverDetails((previous) => {
        if (String(previous.symbol || "").toUpperCase() !== symbol) {
          return previous;
        }
        return {
          open: true,
          symbol,
          row,
          status: "ready",
          data: payload,
          error: ""
        };
      });
    } catch (error) {
      if (controller.signal.aborted || String(error?.name || "").toLowerCase() === "aborterror") {
        return;
      }
      if (topMoverDetailsRequestSeqRef.current !== requestSeq) {
        return;
      }
      showErrorToast(error?.message || `Failed to load ${symbol} details`, "nifty-top-mover-details");
      setTopMoverDetails((previous) => ({
        open: true,
        symbol,
        row,
        status: "error",
        data: previous?.data || null,
        error: error?.message || "Failed to load stock details"
      }));
    } finally {
      if (topMoverDetailsAbortRef.current === controller) {
        topMoverDetailsAbortRef.current = null;
      }
    }
  }, []);

  const selectedCandle = snapshot?.selectedCandle;
  const singleHasExecutedData = Boolean(singleExecution.data);
  const rangeHasExecutedData = Boolean(rangeExecution.data);
  const singleModeActive = selectionMode === "single" && singleHasExecutedData;
  const rangeModeActive = selectionMode === "range" && rangeHasExecutedData;
  const tableRows = rangeModeActive
    ? (rangeExecution.data?.rows || [])
    : (singleModeActive ? (singleExecution.data?.rows || []) : []);
  const tableValidation = rangeModeActive
    ? rangeExecution.data?.validation
    : (singleModeActive ? singleExecution.data?.validation : null);
  const tableSelectedCandle = rangeModeActive
    ? rangeExecution.data?.selectedCandle
    : (singleModeActive ? singleExecution.data?.selectedCandle : selectedCandle);
  const optionsPanelData = selectionMode === "range"
    ? (rangeExecution.data?.options || null)
    : (singleExecution.data?.options || null);
  const latestChartTimestamp = useMemo(() => {
    const timestamps = Array.isArray(liveState.dataset?.indexTimestamps) ? liveState.dataset.indexTimestamps : [];
    if (!timestamps.length) {
      return null;
    }
    const latest = Number(timestamps[timestamps.length - 1]);
    return Number.isFinite(latest) && latest > 0 ? latest : null;
  }, [liveState.dataset?.indexTimestamps]);
  const preExecuteOverviewRangeMeta = useMemo(() => {
    if (Number.isFinite(Number(latestChartTimestamp)) && Number(latestChartTimestamp) > 0) {
      return {
        startTimestamp: Number(latestChartTimestamp),
        endTimestamp: Number(latestChartTimestamp),
        candleCount: 1
      };
    }

    return null;
  }, [latestChartTimestamp]);
  const optionsRangeMeta = selectionMode === "range"
    ? ((rangeModeActive ? (rangeExecution.data?.meta || null) : null) || preExecuteOverviewRangeMeta)
    : ((singleModeActive ? (singleExecution.data?.optionsRangeMeta || null) : null) || preExecuteOverviewRangeMeta);
  const liveLoading = liveState.status === "loading";
  const rangeLoading = rangeExecution.status === "loading";
  const singleLoading = singleExecution.status === "loading";
  const canExecuteRange = Number.isFinite(Number(rangeSelection?.startTimestamp))
    && Number.isFinite(Number(rangeSelection?.endTimestamp))
    && Number(rangeSelection?.endTimestamp) > Number(rangeSelection?.startTimestamp)
    && selectionMode === "range"
    && !rangeLoading;
  const canExecuteSingle = selectionMode === "single" && Number.isFinite(Number(selectedTimestamp)) && !singleLoading;
  const canExecuteSelection = selectionMode === "range" ? canExecuteRange : canExecuteSingle;
  const executeLoading = selectionMode === "range" ? rangeLoading : singleLoading;
  const showInlineTopMoverDetails = Boolean(topMoverDetails.open);
  const selectedIndexLabel = useMemo(
    () => INDEX_OPTIONS.find((option) => option.value === selectedIndex)?.label || selectedIndex,
    [selectedIndex]
  );

  return (
    <main className="relative h-screen overflow-hidden bg-[linear-gradient(180deg,#03070d_0%,#050b14_52%,#03070d_100%)] text-white">
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "#0a1526",
            color: "#e9f1ff",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 12px 34px rgba(0,0,0,0.35)"
          }
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_-8%,rgba(94,184,255,0.07),transparent_40%),radial-gradient(circle_at_84%_8%,rgba(34,213,156,0.04),transparent_34%)]" />

      <div className="relative flex h-full min-h-0 w-full flex-col gap-2 px-3 py-3 sm:px-4 sm:py-4 lg:px-5">
        <section className="min-h-0 flex-1">
          <div className="grid h-full min-h-0 gap-2 lg:grid-cols-[minmax(0,1fr)_21rem] lg:grid-rows-[minmax(0,1fr)_auto] lg:items-stretch">
            <div className="h-full min-h-0 min-w-0 lg:col-start-1 lg:row-start-1">
              <NiftyChart
                candles={dataset?.indexCandles || []}
                selectedCandle={selectedCandle}
                selectedTimestamp={selectedTimestamp}
                selectionMode={selectionMode}
                compactMode
                indexValue={selectedIndex}
                indexOptions={INDEX_OPTIONS}
                onIndexChange={handleIndexChange}
                chartType={chartType}
                chartTypeOptions={CHART_TYPE_OPTIONS}
                onChartTypeChange={handleChartTypeChange}
                timeframe={timeframe}
                timeframeOptions={NIFTY_TIMEFRAME_OPTIONS}
                onTimeframeChange={handleTimeframeChange}
                onSelectionModeChange={handleSelectionModeChange}
                onSelectTimestamp={handleSelectTimestamp}
                onRangeSelectionChange={handleRangeSelectionChange}
                isPending={isPending || liveLoading}
                onExecute={handleExecuteSelection}
                executeDisabled={!canExecuteSelection}
                executeLoading={executeLoading}
              />
            </div>

            <div className="min-h-0 rounded-xl bg-white/[0.015] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.035)] lg:col-start-2 lg:row-span-2">
              <div className="flex h-full min-h-0 flex-col">
                <div className="min-h-0 flex-1 overflow-auto">
                  {showInlineTopMoverDetails ? (
                    <TopMoverDetailsModal
                      open
                      embedded
                      onClose={handleCloseTopMoverDetails}
                      symbol={topMoverDetails.symbol}
                      moverRow={topMoverDetails.row}
                      timeframe={timeframe}
                      selectionMode={selectionMode}
                      loading={topMoverDetails.status === "loading"}
                      data={topMoverDetails.data}
                      error={topMoverDetails.error}
                      indexLabel={selectedIndexLabel}
                    />
                  ) : (selectionMode === "range" ? (
                    rangeModeActive ? (
                      <div className="transition-all duration-300 motion-reduce:transition-none" data-selection={selectedCandle?.timestamp || ""}>
                        <ContributionTable
                          rows={tableRows}
                          validation={tableValidation}
                          selectedCandle={tableSelectedCandle}
                          timeframeLabel={`${timeframe} • range Δ`}
                          sectors={dataset?.sectors || []}
                          tableMode="range"
                          rangeMeta={rangeExecution.data?.meta || null}
                          onRowClick={handleTopMoverRowClick}
                          activeSymbol={topMoverDetails.symbol}
                        />
                      </div>
                    ) : (
                      <div className="px-3 py-2.5 text-sm text-[#9bb2d4]">
                        Execute a range to rank NIFTY 50 movers.
                      </div>
                    )
                  ) : (
                    singleModeActive ? (
                      <div className="transition-all duration-300 motion-reduce:transition-none" data-selection={selectedCandle?.timestamp || ""}>
                        <ContributionTable
                          rows={tableRows}
                          validation={tableValidation}
                          selectedCandle={tableSelectedCandle}
                          timeframeLabel={timeframe}
                          sectors={dataset?.sectors || []}
                          tableMode="candle"
                          rangeMeta={null}
                          onRowClick={handleTopMoverRowClick}
                          activeSymbol={topMoverDetails.symbol}
                        />
                      </div>
                    ) : (
                      <div className="px-3 py-2.5 text-sm text-[#9bb2d4]">
                        Hover a candle, then click Execute.
                      </div>
                    )
                  ))}
                </div>
              </div>
            </div>

            <div className="h-full min-h-0 overflow-hidden lg:col-start-1 lg:row-start-2">
              <RangeOptionsSection
                rangeMeta={optionsRangeMeta}
                optionMetrics={optionsPanelData?.optionMetrics || null}
                marketOverview={optionsPanelData?.marketOverview || null}
                frozenLatestCards={optionsPanelData?.frozenLatestCards || null}
                indexLabel={selectedIndexLabel}
                compactMode
                refreshToken={minuteRefreshToken}
                loading={selectionMode === "range" ? rangeLoading : singleLoading}
                error=""
              />
            </div>
          </div>
        </section>
      </div>

    </main>
  );
}
