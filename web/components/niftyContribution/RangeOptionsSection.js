"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asNumber(value, fallback = NaN) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatPrice(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(numeric);
}

function formatSigned(value, decimals = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  const abs = Math.abs(numeric).toFixed(decimals);
  if (numeric > 0) {
    return `+${abs}`;
  }
  if (numeric < 0) {
    return `-${abs}`;
  }
  return abs;
}

function formatPercent(value, decimals = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `${formatSigned(numeric, decimals)}%`;
}

function formatFixed(value, decimals = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return numeric.toFixed(decimals);
}

function formatInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0
  }).format(numeric);
}

function formatCompact(value, { decimals = 2, signed = false } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }

  const absolute = Math.abs(numeric);
  let divisor = 1;
  let suffix = "";
  let fractionDigits = 0;

  if (absolute >= 10000000) {
    divisor = 10000000;
    suffix = "Cr";
    fractionDigits = decimals;
  } else if (absolute >= 100000) {
    divisor = 100000;
    suffix = "L";
    fractionDigits = decimals;
  } else if (absolute >= 1000) {
    divisor = 1000;
    suffix = "K";
    fractionDigits = decimals;
  }

  const scaled = numeric / divisor;
  if (signed) {
    return `${formatSigned(scaled, fractionDigits)}${suffix}`;
  }

  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: suffix ? fractionDigits : 0,
    maximumFractionDigits: suffix ? fractionDigits : Math.max(0, decimals)
  }).format(scaled);

  return `${formatted}${suffix}`;
}

function formatTimestamp(unixSeconds, withDate = true) {
  const numeric = Number(unixSeconds);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "-";
  }

  const date = new Date(numeric * 1000);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: withDate ? "medium" : undefined,
    timeStyle: "short",
    hour12: false,
    timeZone: "Asia/Kolkata"
  }).format(date);
}

function getAtmStrike(snapshot) {
  if (!snapshot?.strikes?.length || !snapshot?.underlying) {
    return null;
  }

  let best = snapshot.strikes[0];
  let bestDistance = Math.abs(snapshot.strikes[0].strike - snapshot.underlying);

  for (const strike of snapshot.strikes.slice(1)) {
    const distance = Math.abs(strike.strike - snapshot.underlying);
    if (distance < bestDistance) {
      best = strike;
      bestDistance = distance;
    }
  }

  return best;
}

function parseStrikeFromOptionDataKey(key) {
  const upper = String(key || "").toUpperCase().trim();
  if (!upper) {
    return NaN;
  }
  const match = upper.match(/(\d+)(CE|PE)$/);
  if (!match) {
    return NaN;
  }
  return Number(match[1]);
}

function computeFrozenLatestOptionCards(optionMetrics) {
  const snapshot =
    optionMetrics?.latestSnapshot && typeof optionMetrics.latestSnapshot === "object"
      ? optionMetrics.latestSnapshot
      : optionMetrics?.endSnapshot && typeof optionMetrics.endSnapshot === "object"
        ? optionMetrics.endSnapshot
        : null;
  const data = snapshot?.data;
  if (!data || typeof data !== "object") {
    return null;
  }

  let totalCE = 0;
  let totalPE = 0;
  let highestCallOi = 0;
  let highestPutOi = 0;
  let highestCallStrike = 0;
  let highestPutStrike = 0;

  for (const [key, rawValue] of Object.entries(data)) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      continue;
    }

    const upperKey = String(key).toUpperCase().trim();
    const strike = parseStrikeFromOptionDataKey(upperKey);

    if (upperKey.endsWith("CE")) {
      totalCE += value;
      if (value > highestCallOi) {
        highestCallOi = value;
        highestCallStrike = Number.isFinite(strike) ? strike : highestCallStrike;
      }
      continue;
    }

    if (upperKey.endsWith("PE")) {
      totalPE += value;
      if (value > highestPutOi) {
        highestPutOi = value;
        highestPutStrike = Number.isFinite(strike) ? strike : highestPutStrike;
      }
    }
  }

  return {
    timestamp: toFiniteNumber(snapshot?.timestamp, 0),
    summaryOi: totalCE + totalPE,
    summaryPcr: totalCE !== 0 ? totalPE / totalCE : 0,
    highestCallOi,
    highestPutOi,
    highestCallStrike,
    highestPutStrike
  };
}

function computeOptionDiffFromSnapshots(startSnapshot, endSnapshot, limit = 10) {
  if (!startSnapshot || !endSnapshot) {
    return null;
  }

  const underlyingFrom = toFiniteNumber(startSnapshot?.underlying, 0);
  const underlyingTo = toFiniteNumber(endSnapshot?.underlying, 0);
  const underlyingPointChange = underlyingTo - underlyingFrom;
  const underlyingPctChange = underlyingFrom === 0 ? 0 : (underlyingPointChange / underlyingFrom) * 100;

  const startByStrike = new Map();
  const endByStrike = new Map();

  for (const strike of Array.isArray(startSnapshot?.strikes) ? startSnapshot.strikes : []) {
    const strikeValue = toFiniteNumber(strike?.strike, NaN);
    if (Number.isFinite(strikeValue)) {
      startByStrike.set(String(strikeValue), strike);
    }
  }
  for (const strike of Array.isArray(endSnapshot?.strikes) ? endSnapshot.strikes : []) {
    const strikeValue = toFiniteNumber(strike?.strike, NaN);
    if (Number.isFinite(strikeValue)) {
      endByStrike.set(String(strikeValue), strike);
    }
  }

  const rows = [];
  const allStrikes = new Set([...startByStrike.keys(), ...endByStrike.keys()]);

  for (const strikeKey of allStrikes) {
    const start = startByStrike.get(strikeKey) || {};
    const end = endByStrike.get(strikeKey) || {};

    const startCallOI = toFiniteNumber(start?.call?.oi, 0);
    const endCallOI = toFiniteNumber(end?.call?.oi, 0);
    const startPutOI = toFiniteNumber(start?.put?.oi, 0);
    const endPutOI = toFiniteNumber(end?.put?.oi, 0);
    const startCallVolume = toFiniteNumber(start?.call?.volume, 0);
    const endCallVolume = toFiniteNumber(end?.call?.volume, 0);
    const startPutVolume = toFiniteNumber(start?.put?.volume, 0);
    const endPutVolume = toFiniteNumber(end?.put?.volume, 0);
    const startCallIV = toFiniteNumber(start?.call?.iv, 0);
    const endCallIV = toFiniteNumber(end?.call?.iv, 0);
    const startPutIV = toFiniteNumber(start?.put?.iv, 0);
    const endPutIV = toFiniteNumber(end?.put?.iv, 0);

    const callChangeOI = endCallOI - startCallOI;
    const putChangeOI = endPutOI - startPutOI;
    const totalChangeOI = callChangeOI + putChangeOI;
    const callChangeVolume = endCallVolume - startCallVolume;
    const putChangeVolume = endPutVolume - startPutVolume;
    const totalChangeVolume = callChangeVolume + putChangeVolume;
    const callChangeIV = endCallIV - startCallIV;
    const putChangeIV = endPutIV - startPutIV;
    const totalChangeIV = callChangeIV + putChangeIV;

    let direction = "flat";
    if (totalChangeOI > 0) {
      direction = "build_up";
    } else if (totalChangeOI < 0) {
      direction = "unwinding";
    }

    rows.push({
      strike: Number(strikeKey),
      call_change_oi: callChangeOI,
      put_change_oi: putChangeOI,
      total_change_oi: totalChangeOI,
      call_change_volume: callChangeVolume,
      put_change_volume: putChangeVolume,
      total_change_volume: totalChangeVolume,
      call_change_iv: callChangeIV,
      put_change_iv: putChangeIV,
      total_change_iv: totalChangeIV,
      oi_build_direction: direction
    });
  }

  rows.sort((a, b) => {
    const diff = Math.abs(b.total_change_oi) - Math.abs(a.total_change_oi);
    if (diff !== 0) {
      return diff;
    }
    return a.strike - b.strike;
  });

  return {
    underlying_from: underlyingFrom,
    underlying_to: underlyingTo,
    underlying_point_change: underlyingPointChange,
    underlying_pct_change: underlyingPctChange,
    top_strikes: rows.slice(0, Math.max(1, limit))
  };
}

function valueColorClass(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "text-[#b7c3d8]";
  }
  return numeric >= 0 ? "text-[#17c964]" : "text-[#ff7f99]";
}

const OVERVIEW_CLIENT_CACHE_TTL_MS = 45 * 1000;
const OVERVIEW_FETCH_DEBOUNCE_MS = 300;
const OVERVIEW_CLIENT_TIMEOUT_MS = 2600;
const overviewClientCache = new Map();
const overviewClientInflight = new Map();

async function fetchMarketOverviewCached(startTimestamp, endTimestamp, refreshToken = 0, requestSignal = null) {
  const from = Number(startTimestamp);
  const to = Number(endTimestamp);
  const minuteKey = Number(refreshToken);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) {
    return null;
  }

  const safeMinuteKey = Number.isFinite(minuteKey) ? Math.floor(minuteKey) : 0;
  const key = `${Math.floor(from)}:${Math.floor(to)}:${safeMinuteKey}`;
  const now = Date.now();
  const cached = overviewClientCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.payload;
  }

  if (overviewClientInflight.has(key)) {
    return overviewClientInflight.get(key);
  }

  const promise = (async () => {
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    if (requestSignal) {
      if (requestSignal.aborted) {
        controller.abort();
      } else {
        requestSignal.addEventListener("abort", onExternalAbort, { once: true });
      }
    }
    const timeoutId = setTimeout(() => controller.abort(), OVERVIEW_CLIENT_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(`/api/market/overview?lean=1&from=${encodeURIComponent(String(Math.floor(from)))}&to=${encodeURIComponent(String(Math.floor(to)))}&minute_key=${encodeURIComponent(String(safeMinuteKey))}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      });
    } catch (error) {
      if (String(error?.name || "").toLowerCase() === "aborterror") {
        throw new Error("Market overview timeout");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      if (requestSignal) {
        requestSignal.removeEventListener("abort", onExternalAbort);
      }
    }
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      throw new Error(payload?.error || `Market overview request failed (${response.status})`);
    }
    overviewClientCache.set(key, {
      payload,
      expiresAt: Date.now() + OVERVIEW_CLIENT_CACHE_TTL_MS
    });
    if (overviewClientCache.size > 12) {
      const firstKey = overviewClientCache.keys().next().value;
      overviewClientCache.delete(firstKey);
    }
    return payload;
  })();

  overviewClientInflight.set(key, promise);
  try {
    return await promise;
  } finally {
    overviewClientInflight.delete(key);
  }
}

export default function RangeOptionsSection({
  rangeMeta = null,
  optionMetrics = null,
  marketOverview = null,
  frozenLatestCards = null,
  indexLabel = "NIFTY 50",
  compactMode = false,
  refreshToken = 0,
  loading = false,
  error = ""
}) {
  const [overviewState, setOverviewState] = useState({
    status: "idle",
    data: null,
    error: ""
  });

  useEffect(() => {
    if (marketOverview) {
      setOverviewState({
        status: "ready",
        data: marketOverview,
        error: ""
      });
      return;
    }

    const startTimestamp = Number(rangeMeta?.startTimestamp);
    const endTimestamp = Number(rangeMeta?.endTimestamp);
    if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp) || startTimestamp <= 0 || endTimestamp <= 0) {
      setOverviewState((previous) => ({
        status: previous.data ? "ready" : "idle",
        data: previous.data,
        error: ""
      }));
      return;
    }

    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (!active) {
        return;
      }

      setOverviewState((previous) => ({
        status: previous.data ? "refreshing" : "loading",
        data: previous.data,
        error: ""
      }));

      fetchMarketOverviewCached(startTimestamp, endTimestamp, refreshToken, controller.signal)
        .then((payload) => {
          if (!active) {
            return;
          }
          setOverviewState({
            status: "ready",
            data: payload,
            error: ""
          });
        })
        .catch((fetchError) => {
          if (!active) {
            return;
          }
          if (controller.signal.aborted || String(fetchError?.name || "").toLowerCase() === "aborterror") {
            return;
          }
          if (String(fetchError?.message || "").toLowerCase().includes("timeout")) {
            return;
          }
          setOverviewState((previous) => ({
            status: previous.data ? "ready" : "error",
            data: previous.data,
            error: fetchError?.message || "Failed to load market overview"
          }));
          toast.error(fetchError?.message || "Failed to load market overview", {
            id: "nifty-market-overview",
            duration: 4000
          });
        });
    }, OVERVIEW_FETCH_DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [marketOverview, rangeMeta?.startTimestamp, rangeMeta?.endTimestamp, refreshToken]);

  const optionsDiff = useMemo(
    () => computeOptionDiffFromSnapshots(optionMetrics?.startSnapshot || null, optionMetrics?.endSnapshot || null, 10),
    [optionMetrics]
  );
  const frozenLatestOptionCards = useMemo(() => {
    if (frozenLatestCards && typeof frozenLatestCards === "object") {
      return frozenLatestCards;
    }
    return optionMetrics ? computeFrozenLatestOptionCards(optionMetrics) : null;
  }, [frozenLatestCards, optionMetrics]);

  const resolvedMarketOverview = marketOverview || overviewState.data || null;
  const hasOptionsData = Boolean(optionMetrics || optionsDiff);
  const shouldRenderCards = compactMode || hasOptionsData;
  const quotePrice = asNumber(optionMetrics?.endSnapshot?.underlying, asNumber(resolvedMarketOverview?.quote?.price, 0));
  const quoteChangePct = asNumber(optionsDiff?.underlying_pct_change, asNumber(resolvedMarketOverview?.quote?.changePct, 0));
  const quoteActive = Boolean(optionMetrics?.endSnapshot) || Boolean(resolvedMarketOverview?.quote?.active);
  const quoteTagClass = Number.isFinite(quoteChangePct)
    ? (quoteChangePct >= 0 ? "bg-[#083126] text-[#43d59f]" : "bg-[#3f1020] text-[#ff89a1]")
    : "bg-[#2b3340] text-[#b9c6da]";

  const summaryPcr = Number.isFinite(asNumber(frozenLatestOptionCards?.summaryPcr, NaN))
    ? asNumber(frozenLatestOptionCards?.summaryPcr, 0)
    : asNumber(optionMetrics?.session?.pcr, asNumber(resolvedMarketOverview?.oiTotals?.pcr, 0));
  const summaryOi = Number.isFinite(asNumber(frozenLatestOptionCards?.summaryOi, NaN))
    ? asNumber(frozenLatestOptionCards?.summaryOi, 0)
    : asNumber(optionMetrics?.session?.totalOi, asNumber(resolvedMarketOverview?.oiTotals?.total, 0));
  const atyLabel = String(resolvedMarketOverview?.aty || (Number.isFinite(quoteChangePct) && Math.abs(quoteChangePct) >= 0.75 ? "High" : "Medium"));

  const selectedCallOiTotal = asNumber(optionMetrics?.selected?.callOiTotal, 0);
  const selectedPutOiTotal = asNumber(optionMetrics?.selected?.putOiTotal, 0);
  const selectedRangePcr = asNumber(optionMetrics?.selected?.pcr, 0);
  const selectedDistributionBase = Math.max(selectedCallOiTotal, selectedPutOiTotal, 1);
  const hasSelectedDistribution = selectedCallOiTotal > 0 || selectedPutOiTotal > 0;
  const callsDistributionWidth = hasSelectedDistribution
    ? `${Math.max((selectedCallOiTotal / selectedDistributionBase) * 100, 3)}%`
    : "0%";
  const putsDistributionWidth = hasSelectedDistribution
    ? `${Math.max((selectedPutOiTotal / selectedDistributionBase) * 100, 3)}%`
    : "0%";

  // Keep these cards at zero until explicit Execute returns optionMetrics.
  const netOiChange = asNumber(optionMetrics?.netOiChange?.net, 0);
  const netOiChangePct = asNumber(optionMetrics?.netOiChange?.pct, 0);

  const highestCallStrike = Number.isFinite(asNumber(frozenLatestOptionCards?.highestCallStrike, NaN))
    ? asNumber(frozenLatestOptionCards?.highestCallStrike, 0)
    : asNumber(optionMetrics?.highestOI?.callStrike, 0);
  const highestCallOi = Number.isFinite(asNumber(frozenLatestOptionCards?.highestCallOi, NaN))
    ? asNumber(frozenLatestOptionCards?.highestCallOi, 0)
    : asNumber(optionMetrics?.highestOI?.callOI, 0);
  const highestPutStrike = Number.isFinite(asNumber(frozenLatestOptionCards?.highestPutStrike, NaN))
    ? asNumber(frozenLatestOptionCards?.highestPutStrike, 0)
    : asNumber(optionMetrics?.highestOI?.putStrike, 0);
  const highestPutOi = Number.isFinite(asNumber(frozenLatestOptionCards?.highestPutOi, NaN))
    ? asNumber(frozenLatestOptionCards?.highestPutOi, 0)
    : asNumber(optionMetrics?.highestOI?.putOI, 0);
  const atmStart = getAtmStrike(optionMetrics?.startSnapshot);
  const atmEnd = getAtmStrike(optionMetrics?.endSnapshot);
  const compactCardClass = "h-full min-h-0 min-w-0 rounded-xl bg-[linear-gradient(180deg,rgba(8,12,19,0.98),rgba(6,10,16,0.96))] px-2.5 py-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]";
  const resolvedIndexLabel = String(indexLabel || "NIFTY 50")
    .replace(/nifty50/i, "NIFTY 50")
    .replace(/nifty bank/i, "NIFTY BANK")
    .trim()
    .toUpperCase();

  const marketStatsCards = (
    <div className={`${compactCardClass} flex flex-col justify-between`}>
      <div className="grid grid-cols-4 gap-1">
        <div className="rounded-md bg-[#0d325f]/45 p-1 text-center shadow-[inset_0_0_0_1px_rgba(106,177,255,0.1)]">
          <p className="text-[10px] text-[#9cc9ff]">Stock</p>
          <p className="text-[14px] font-semibold leading-none text-[#e4f1ff]">{formatInteger(asNumber(resolvedMarketOverview?.breadth?.stockTraded, 0))}</p>
        </div>
        <div className="rounded-md bg-[#12492d]/45 p-1 text-center shadow-[inset_0_0_0_1px_rgba(48,212,143,0.1)]">
          <p className="text-[10px] text-[#93e3b4]">Advances</p>
          <p className="text-[14px] font-semibold leading-none text-[#dbfae8]">{formatInteger(asNumber(resolvedMarketOverview?.breadth?.stockAdvanced, 0))}</p>
        </div>
        <div className="rounded-md bg-[#511127]/45 p-1 text-center shadow-[inset_0_0_0_1px_rgba(255,104,130,0.1)]">
          <p className="text-[10px] text-[#ffafbf]">Declines</p>
          <p className="text-[14px] font-semibold leading-none text-[#ffe2ea]">{formatInteger(asNumber(resolvedMarketOverview?.breadth?.stockDeclines, 0))}</p>
        </div>
        <div className="rounded-md bg-[#583f12]/45 p-1 text-center shadow-[inset_0_0_0_1px_rgba(246,212,138,0.08)]">
          <p className="text-[10px] text-[#f6d48a]">Unchange</p>
          <p className="text-[14px] font-semibold leading-none text-[#fff0cc]">{formatInteger(asNumber(resolvedMarketOverview?.breadth?.stockUnchanged, 0))}</p>
        </div>
      </div>
      <div className="grid grid-cols-[1.12fr_1fr_1fr] gap-1 text-center">
        <div className="flex items-center justify-center">
          <p className="text-[10px] text-[#9fb2cf]">No. of Stocks at</p>
        </div>
        <div>
          <p className="text-[10px] text-[#9fb2cf]">52-Week High</p>
          <p className="mt-0.5 text-[14px] font-bold leading-none text-[#20d68d]">{formatInteger(asNumber(resolvedMarketOverview?.levels?.high52Week, 0))}</p>
        </div>
        <div>
          <p className="text-[10px] text-[#9fb2cf]">52-Week Low</p>
          <p className="mt-0.5 text-[14px] font-bold leading-none text-[#ff6882]">{formatInteger(asNumber(resolvedMarketOverview?.levels?.low52Week, 0))}</p>
        </div>
      </div>
      <div className="h-px bg-white/[0.05]" />
      <div className="grid grid-cols-[1.12fr_1fr_1fr] gap-1 text-center">
        <div className="flex items-center justify-center">
          <p className="text-[10px] text-[#9fb2cf]">No. of Stocks in</p>
        </div>
        <div>
          <p className="text-[10px] text-[#9fb2cf]">Upper Circuit</p>
          <p className="mt-0.5 text-[14px] font-bold leading-none text-[#20d68d]">{formatInteger(asNumber(resolvedMarketOverview?.levels?.upperCircuit, 0))}</p>
        </div>
        <div>
          <p className="text-[10px] text-[#9fb2cf]">Lower Circuit</p>
          <p className="mt-0.5 text-[14px] font-bold leading-none text-[#ff6882]">{formatInteger(asNumber(resolvedMarketOverview?.levels?.lowerCircuit, 0))}</p>
        </div>
      </div>
    </div>
  );

  return (
    <section className="h-full overflow-hidden rounded-2xl bg-[#070d16]/70 p-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)]">
      {!shouldRenderCards ? (
        <div className="flex h-full items-center px-2 py-1.5 text-sm text-[#9bb2d4]">
          {loading ? "Loading..." : "Execute to load options data."}
        </div>
      ) : (
        <div className="h-full p-1.5">
          <div className="grid h-full min-w-0 grid-cols-1 auto-rows-fr items-stretch gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <div className={`${compactCardClass} flex flex-col justify-between`}>
                <div className="flex items-start justify-between gap-1">
                  <p className="inline-flex items-center gap-1.5 text-base font-bold leading-none text-[#f1f5ff]">
                    <span className="h-2 w-2 rounded-full bg-[#4ca3ff]" />
                    <span>{resolvedIndexLabel}</span>
                  </p>
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${quoteActive ? "bg-[#0f2f57]/65 text-[#7db5ff]" : "bg-white/[0.06] text-[#b7c3d8]"}`}>
                    {loading ? "Loading" : quoteActive ? "Active" : "Closed"}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <p className="text-[2rem] font-bold leading-none text-white">{formatPrice(quotePrice)}</p>
                  <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${quoteTagClass}`}>
                    {formatPercent(quoteChangePct, 2)}
                  </span>
                </div>
                <div className="mt-auto grid grid-cols-3 gap-1 text-xs">
                  <div className="flex min-h-[44px] flex-col justify-center rounded-md bg-[#3a0f1f]/45 px-1.5 py-1.5 shadow-[inset_0_0_0_1px_rgba(255,120,146,0.09)]">
                    <p className="text-[#ff8ea4]">PCR</p>
                    <p className="mt-0.5 text-[12px] font-semibold leading-none text-[#ffcfda]">{formatFixed(summaryPcr, 2)}</p>
                  </div>
                  <div className="flex min-h-[44px] flex-col justify-center rounded-md bg-[#082344]/45 px-1.5 py-1.5 shadow-[inset_0_0_0_1px_rgba(104,175,255,0.09)]">
                    <p className="text-[#6eb4ff]">OI</p>
                    <p className="mt-0.5 text-[12px] font-semibold leading-none text-[#d4e9ff]">{formatCompact(summaryOi, { decimals: 2 })}</p>
                  </div>
                  <div className="flex min-h-[44px] flex-col justify-center rounded-md bg-white/[0.03] px-1.5 py-1.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.035)]">
                    <p className="text-[#a8b2bf]">ATY</p>
                    <p className="mt-0.5 text-[12px] font-semibold leading-none text-[#e5ecf7]">{atyLabel}</p>
                  </div>
                </div>
              </div>

              <div className={`${compactCardClass} flex flex-col justify-between`}>
                <div className="flex items-start justify-between gap-1">
                  <p className="text-[13px] font-semibold leading-tight text-[#99a9bf]">OI Change Distribution</p>
                  <span className="rounded-md bg-[#3a1221]/55 px-2 py-0.5 text-[10px] font-semibold text-[#ff91a7] shadow-[inset_0_0_0_1px_rgba(255,145,167,0.12)]">
                    PCR {formatFixed(selectedRangePcr, 2)}
                  </span>
                </div>
                <div className="mt-1.5 space-y-1.5 pb-0.5">
                  <div>
                    <div className="mb-1 flex items-center justify-between text-[10px] text-[#c7d2e3]">
                      <span>Calls OI</span>
                      <span>{formatInteger(selectedCallOiTotal)}</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-white/[0.08]">
                      <div className="h-full rounded-full bg-[#da4862]" style={{ width: callsDistributionWidth }} />
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-[10px] text-[#c7d2e3]">
                      <span>Puts OI</span>
                      <span>{formatInteger(selectedPutOiTotal)}</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-white/[0.08]">
                      <div className="h-full rounded-full bg-[#17c964]" style={{ width: putsDistributionWidth }} />
                    </div>
                  </div>
                </div>
              </div>

              <div className={`${compactCardClass} flex flex-col justify-between`}>
                <div className="flex items-center justify-between">
                  <div className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/[0.04] text-[13px] text-[#9ca9bc]">↗</div>
                  <p className={`text-[1.05rem] font-bold ${valueColorClass(netOiChangePct)}`}>{formatPercent(netOiChangePct, 2)}</p>
                </div>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#a8b7cb]">Net OI Change</p>
                <p className="mt-1 text-[1.15rem] font-bold leading-none text-[#f4f7ff]">
                  {formatCompact(netOiChange, { decimals: 2, signed: true })}
                </p>
                <p className="mt-1 text-[9px] leading-[1.15] text-[#8998ad]">
                  Net OI change for Nifty 50 shows the daily variation in open contracts, reflecting market sentiment.
                </p>
              </div>

              <div className={`${compactCardClass} flex flex-col justify-between`}>
                <p className="text-[15px] font-semibold text-[#f2f5ff]">Highest OI</p>
                <div className="mt-1.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 rounded-md bg-[#3c0e1e]/45 p-1.5 shadow-[inset_0_0_0_1px_rgba(255,118,146,0.1)]">
                    <div>
                      <p className="text-[10px] font-semibold text-[#f4d4dc]">Call OI</p>
                      <p className="text-[10px] text-[#f4d4dc]">{formatInteger(highestCallStrike)}</p>
                    </div>
                    <span className="rounded-md bg-[#7d1c3d]/75 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-[#ffd4e0]">{formatInteger(highestCallOi)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-md bg-[#0b3b23]/45 p-1.5 shadow-[inset_0_0_0_1px_rgba(38,211,131,0.1)]">
                    <div>
                      <p className="text-[10px] font-semibold text-[#c9f3dc]">Put OI</p>
                      <p className="text-[10px] text-[#c9f3dc]">{formatInteger(highestPutStrike)}</p>
                    </div>
                    <span className="rounded-md bg-[#10834a]/75 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-[#d3fae5]">{formatInteger(highestPutOi)}</span>
                  </div>
                </div>
              </div>

              {marketStatsCards}
          </div>

          {!compactMode ? (
            <>
              <div className="grid gap-2 lg:grid-cols-2">
                <div className="rounded-xl border border-[#214065] bg-[#06162b] p-3">
                  <p className="text-[10px] uppercase tracking-[0.08em] text-[#84a0c6]">Start Timestamp</p>
                  <p className="mt-1 text-sm font-semibold text-[#e8f3ff]">{formatTimestamp(rangeMeta?.startTimestamp)}</p>
                </div>
                <div className="rounded-xl border border-[#214065] bg-[#06162b] p-3">
                  <p className="text-[10px] uppercase tracking-[0.08em] text-[#84a0c6]">End Timestamp</p>
                  <p className="mt-1 text-sm font-semibold text-[#e8f3ff]">{formatTimestamp(rangeMeta?.endTimestamp)}</p>
                </div>
              </div>

              {optionsDiff ? (
                <div className="grid gap-2 lg:grid-cols-3">
                  <div className="rounded-xl border border-[#214065] bg-[#06162b] p-3">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-[#84a0c6]">Underlying (Start)</p>
                    <p className="mt-1 text-sm font-semibold text-[#e8f3ff]">{formatPrice(optionsDiff.underlying_from)}</p>
                  </div>
                  <div className="rounded-xl border border-[#214065] bg-[#06162b] p-3">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-[#84a0c6]">Underlying (End)</p>
                    <p className="mt-1 text-sm font-semibold text-[#e8f3ff]">{formatPrice(optionsDiff.underlying_to)}</p>
                  </div>
                  <div className="rounded-xl border border-[#214065] bg-[#06162b] p-3">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-[#84a0c6]">Underlying Change</p>
                    <p className={`mt-1 text-sm font-semibold ${valueColorClass(optionsDiff.underlying_point_change)}`}>
                      {formatSigned(optionsDiff.underlying_point_change, 2)} ({formatPercent(optionsDiff.underlying_pct_change, 3)})
                    </p>
                  </div>
                </div>
              ) : null}

              {atmStart && atmEnd ? (
                <div className="grid gap-2 lg:grid-cols-2">
                  <div className="rounded-xl border border-[#214065] bg-[#06162b] p-3 text-xs text-[#c2d4ef]">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-[#84a0c6]">Start Snapshot ATM</p>
                    <p className="mt-1">
                      Strike {formatPrice(atmStart.strike)} | Call OI {formatInteger(atmStart.call.oi)} | Put OI {formatInteger(atmStart.put.oi)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#214065] bg-[#06162b] p-3 text-xs text-[#c2d4ef]">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-[#84a0c6]">End Snapshot ATM</p>
                    <p className="mt-1">
                      Strike {formatPrice(atmEnd.strike)} | Call OI {formatInteger(atmEnd.call.oi)} | Put OI {formatInteger(atmEnd.put.oi)}
                    </p>
                  </div>
                </div>
              ) : null}

              {!optionsDiff ? (
                <p className="text-sm text-[#9bb2d4]">Option diff unavailable.</p>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
