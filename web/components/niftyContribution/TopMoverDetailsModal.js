"use client";

import { useEffect, useMemo, useState } from "react";

function asFiniteNumber(value, fallback = 0) {
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

function formatPercent(value, decimals = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  const abs = Math.abs(numeric).toFixed(decimals);
  if (numeric > 0) {
    return `+${abs}%`;
  }
  if (numeric < 0) {
    return `-${abs}%`;
  }
  return `${abs}%`;
}

function formatCompactCr(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(numeric);
}

function formatNumber(value, decimals = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return numeric.toFixed(decimals);
}

function valueTextClass(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "text-[#c8d3e5]";
  }
  return numeric >= 0 ? "text-[#17d692]" : "text-[#ff7286]";
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(max, Math.max(min, numeric));
}

function computeStdDev(values) {
  const nums = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(Number(v))).map(Number);
  if (nums.length < 2) {
    return 0;
  }
  const mean = nums.reduce((sum, value) => sum + value, 0) / nums.length;
  const variance = nums.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (nums.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function computeTopMoverSignals({ quote, deliveryTrend, moverRow }) {
  const rows = Array.isArray(deliveryTrend) ? deliveryTrend : [];
  const latestDelivery = rows.length ? asFiniteNumber(rows[rows.length - 1]?.deliveryPercent, 0) : 0;
  const last5 = rows.slice(-5).map((row) => asFiniteNumber(row?.deliveryPercent, 0));
  const last15 = rows.slice(-15).map((row) => asFiniteNumber(row?.deliveryPercent, 0));
  const avg5 = last5.length ? (last5.reduce((sum, value) => sum + value, 0) / last5.length) : 0;
  const avg15 = last15.length ? (last15.reduce((sum, value) => sum + value, 0) / last15.length) : 0;

  const closeSeries = rows
    .map((row) => asFiniteNumber(row?.closePrice, NaN))
    .filter((value) => Number.isFinite(value) && value > 0);
  const dailyReturns = [];
  for (let index = 1; index < closeSeries.length; index += 1) {
    const prev = closeSeries[index - 1];
    const next = closeSeries[index];
    if (prev > 0) {
      dailyReturns.push(((next - prev) / prev) * 100);
    }
  }

  const quoteChange = asFiniteNumber(quote?.percentChange, 0);
  const moverChange = asFiniteNumber(moverRow?.perChange, quoteChange);
  const open = asFiniteNumber(quote?.open, NaN);
  const current = asFiniteNumber(quote?.currentPrice, NaN);
  const vwap = asFiniteNumber(quote?.vwap, NaN);

  const shortScore = clamp(50 + (quoteChange * 9) + ((latestDelivery - avg15) * 0.7), 0, 100);
  const longScore = clamp(50 + ((avg5 - avg15) * 1.5) + ((Number.isFinite(current) && Number.isFinite(vwap) && vwap > 0) ? (((current - vwap) / vwap) * 100 * 8) : 0), 0, 100);

  const momentumLabel = quoteChange >= 0.4 ? "Momentum Bullish" : quoteChange <= -0.4 ? "Momentum Bearish" : "Momentum Neutral";
  const structureLabel = Number.isFinite(current) && Number.isFinite(open)
    ? (current >= open ? "Rising Structure" : "Falling Structure")
    : "Structure Mixed";
  const trendStrengthLabel = Math.abs(avg5 - avg15) >= 4 || Math.abs(moverChange) >= 1 ? "Trend Strong" : "Trend Moderate";
  const sameDirection = (quoteChange === 0 && moverChange === 0) || (quoteChange > 0 && moverChange > 0) || (quoteChange < 0 && moverChange < 0);
  const reversalLabel = sameDirection ? "Reversal Unlikely" : "Reversal Unexpected";

  return {
    shortScore,
    longScore,
    latestDelivery,
    avg5,
    avg15,
    dailyVolatility: computeStdDev(dailyReturns),
    cards: [
      { title: "Momentum", label: momentumLabel, tone: quoteChange >= 0 ? "pos" : "neg" },
      { title: "Structure", label: structureLabel, tone: (Number.isFinite(current) && Number.isFinite(open) && current >= open) ? "pos" : "neg" },
      { title: "Trend", label: trendStrengthLabel, tone: "neutral" },
      { title: "Reversal", label: reversalLabel, tone: sameDirection ? "neutral" : "warn" }
    ]
  };
}

function gaugeStrokeColor(score) {
  const numeric = asFiniteNumber(score, 0);
  if (numeric >= 60) {
    return "#20d48f";
  }
  if (numeric <= 40) {
    return "#ff5e72";
  }
  return "#f59e0b";
}

function symbolBadgeClasses(symbol) {
  let hash = 0;
  const text = String(symbol || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }

  const palettes = [
    "from-[#1d4ed8] to-[#38bdf8]",
    "from-[#a21caf] to-[#f472b6]",
    "from-[#059669] to-[#34d399]",
    "from-[#dc2626] to-[#fb7185]",
    "from-[#ca8a04] to-[#facc15]",
    "from-[#4f46e5] to-[#818cf8]"
  ];

  return palettes[Math.abs(hash) % palettes.length];
}

const IMAGE_ALIAS_MAP = {
  "M&M": "M&M",
  "HEROMOTOCO": "HEROMOTOCO",
  "BAJAJFINSV": "BAJAJFINSV",
  "BAJFINANCE": "BAJFINANCE",
  "BAJAJ-AUTO": "BAJAJ-AUTO",
  "MCDOWELL-N": "MCDOWELL-N",
  "NIFTY50": "NIFTY_50"
};

function getSymbolImageCandidates(symbol) {
  const raw = String(symbol || "").trim().toUpperCase();
  if (!raw) {
    return [];
  }

  const sanitizedUnderscore = raw.replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const sanitizedNoPunct = raw.replace(/[^A-Z0-9]+/g, "");
  const explicitAlias = IMAGE_ALIAS_MAP[raw];

  return Array.from(new Set([
    raw,
    explicitAlias,
    sanitizedUnderscore,
    sanitizedNoPunct
  ].filter(Boolean))).map((name) => `/assets/images/fno_symbol_curved/${name}.webp`);
}

function StockHeaderIcon({ symbol }) {
  const [failedIndex, setFailedIndex] = useState(0);
  const candidates = useMemo(() => getSymbolImageCandidates(symbol), [symbol]);
  const src = candidates[failedIndex] || null;

  if (src) {
    return (
      <img
        src={src}
        alt={String(symbol || "")}
        width={24}
        height={24}
        loading="lazy"
        className="h-6 w-6 shrink-0 rounded-full object-cover shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
        onError={() => {
          setFailedIndex((previous) => previous + 1);
        }}
      />
    );
  }

  return (
    <div className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${symbolBadgeClasses(symbol)} ring-1 ring-white/15`}>
      <span className="text-[8px] font-bold text-white">
        {String(symbol || "").replace(/[^A-Z]/gi, "").slice(0, 2).toUpperCase() || "?"}
      </span>
    </div>
  );
}

function SemiGauge({ value = 0, label = "", subtitle = "" }) {
  const score = clamp(value, 0, 100);
  const angle = -90 + (score * 1.8);
  const stroke = gaugeStrokeColor(score);
  return (
    <div className="rounded-lg bg-white/[0.02] px-2 py-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)]">
      <div className="relative mx-auto h-20 w-36">
        <div
          className="absolute inset-x-0 top-2 mx-auto h-16 w-32 rounded-t-full border-[4px] border-b-0 border-[#2a374b]"
          style={{
            background: `conic-gradient(from 180deg at 50% 100%, ${stroke} 0deg ${score * 1.8}deg, transparent ${score * 1.8}deg 180deg)`
          }}
        />
        <div className="absolute inset-x-0 top-4 mx-auto h-12 w-24 rounded-t-full bg-[#07111f]" />
        <div
          className="absolute left-1/2 top-[18px] h-10 w-[2px] origin-bottom -translate-x-1/2 rounded-full bg-[#d7e6ff]"
          style={{ transform: `translateX(-50%) rotate(${angle}deg)` }}
        />
        <div className="absolute left-1/2 top-[54px] h-2.5 w-2.5 -translate-x-1/2 rounded-full border border-[#8fb4ea] bg-[#12305d]" />
      </div>
      <div className="-mt-1 text-center">
        <p className="text-[11px] font-semibold text-[#e7eefb]">{label}</p>
        {subtitle ? <p className="mt-0.5 text-[10px] text-[#8ea3c1]">{subtitle}</p> : null}
      </div>
    </div>
  );
}

function signalCardToneClasses(tone) {
  if (tone === "pos") {
    return "bg-[#0e261d]/80";
  }
  if (tone === "neg") {
    return "bg-[#2a141a]/80";
  }
  if (tone === "warn") {
    return "bg-[#2c220f]/80";
  }
  return "bg-[#0d1725]/80";
}

function StrategyGrid({ signals }) {
  const cards = Array.isArray(signals?.cards) ? signals.cards : [];
  return (
    <div className="px-0.5 py-0.5">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.13em] text-[#9fb1cc]">Market Strategies</p>
      <div className="grid grid-cols-2 gap-1.5">
        {cards.map((card) => (
          <div
            key={`${card.title}-${card.label}`}
            className={`rounded-lg px-2.5 py-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] ${signalCardToneClasses(card.tone)}`}
          >
            <p className="text-[9px] uppercase tracking-[0.11em] text-[#8ea3c1]">{card.title}</p>
            <p className="mt-1 text-[12px] font-medium leading-tight text-[#e6eefc]">{card.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompactFactsTable({ quote, signals, indexLabel }) {
  const latestDelivery = asFiniteNumber(signals?.latestDelivery, NaN);
  const dailyVolatility = asFiniteNumber(signals?.dailyVolatility, NaN);
  const rows = [
    ["Total Market Cap (Rs Cr.)", formatCompactCr(quote?.estimatedMarketCapCr)],
    ["Free Float Market Cap (Rs Cr.)", formatCompactCr(quote?.estimatedFreeFloatMarketCapCr)],
    ["% Deliverable / Traded Qty", Number.isFinite(latestDelivery) ? `${formatNumber(latestDelivery, 2)}%` : "-"],
    ["Index", indexLabel || "-"],
    ["Industry", quote?.industry || quote?.sector || "-"],
    ["Daily Volatility", Number.isFinite(dailyVolatility) ? formatNumber(dailyVolatility, 2) : "-"],
    ["Symbol P/E", quote?.symbolPe === null || quote?.symbolPe === undefined ? "-" : formatNumber(quote.symbolPe, 2)]
  ];

  return (
    <div className="px-0.5 py-0.5">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.13em] text-[#9fb1cc]">Market Snapshot</p>
      <div className="overflow-hidden rounded-lg bg-white/[0.02] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)]">
        {rows.map(([label, value], index) => (
          <div
            key={label}
            className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-1.5 text-xs ${index % 2 === 0 ? "bg-white/[0.01]" : "bg-white/[0.03]"}`}
          >
            <span className="truncate text-[#9fb1cc]">{label}</span>
            <span className="max-w-[11rem] truncate font-semibold text-[#edf4ff]">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SkeletonBlock({ className = "" }) {
  return (
    <div className={`animate-pulse rounded-md bg-white/5 ${className}`} />
  );
}

function DeliveryTrendChart({ rows = [] }) {
  const normalizedRows = Array.isArray(rows) ? rows.filter((row) => Number.isFinite(Number(row?.deliveryPercent))) : [];
  const maxDelivery = useMemo(() => {
    const max = normalizedRows.reduce((acc, row) => Math.max(acc, asFiniteNumber(row.deliveryPercent, 0)), 0);
    return Math.max(10, Math.ceil(max / 10) * 10);
  }, [normalizedRows]);

  if (!normalizedRows.length) {
    return (
      <div className="px-1 py-2 text-sm text-[#9fb1cc]">
        Delivery trend data is unavailable for the selected symbol right now.
      </div>
    );
  }

  return (
    <div className="px-0.5 py-0.5">
      <div className="relative h-36 overflow-visible px-1.5 pb-16 pt-0.5">
        <div className="relative z-10 grid h-full grid-cols-[repeat(auto-fit,minmax(13px,1fr))] items-end gap-1.5">
          {normalizedRows.map((row) => {
            const deliveryPercent = asFiniteNumber(row.deliveryPercent, 0);
            const barHeight = Math.max(6, (deliveryPercent / Math.max(maxDelivery, 1)) * 100);
            return (
              <div key={`${row.timestamp}-${row.dateLabel}`} className="flex h-full min-w-0 flex-col justify-end">
                <div
                  className="group relative flex-1"
                  title={`${row.dateLabel || row.date || "-"} • ${deliveryPercent.toFixed(2)}%`}
                >
                  <div
                    className="absolute bottom-0 left-0 right-0 rounded-t-[4px] bg-[linear-gradient(180deg,#59b0ff,#2a6fd5)] shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                    style={{ height: `${barHeight}%` }}
                  />
                </div>
                <p className="mt-2.5 translate-y-6 origin-top-left rotate-[-62deg] whitespace-nowrap text-[9px] leading-none text-[#8ea3c1]">
                  {String(row.dateLabel || row.date || "").replace(/\s+/g, "")}
                </p>
              </div>
            );
          })}
        </div>
      </div>
      <p className="-mt-3 text-center text-sm font-semibold text-[#eef4ff]">Delivery Trend</p>
    </div>
  );
}

function RangeSlider52W({ quote }) {
  const low = asFiniteNumber(quote?.week52Low, NaN);
  const high = asFiniteNumber(quote?.week52High, NaN);
  const current = asFiniteNumber(quote?.currentMarkerPrice ?? quote?.currentPrice, NaN);
  const valid = Number.isFinite(low) && Number.isFinite(high) && high > low && Number.isFinite(current);
  const markerPercent = valid ? Math.min(100, Math.max(0, ((current - low) / (high - low)) * 100)) : 0;

  return (
    <div className="px-0.5 py-0.5">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#9fb1cc]">52 Week Range</p>
      </div>

      {valid ? (
        <>
          <div className="relative px-0.5 py-2">
            <div className="h-2 rounded-full bg-[linear-gradient(90deg,#2d7dff,#1cc0e4,#16d76f)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" />
            <div
              className="pointer-events-none absolute top-0 -translate-x-1/2"
              style={{ left: `${markerPercent}%` }}
              title={`Current ${formatPrice(current)}`}
            >
              <div className="h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-[#7ec3ff] drop-shadow-[0_0_8px_rgba(74,162,255,0.75)]" />
            </div>
          </div>

          <div className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-sm">
            <div className="min-w-0">
              <p className="font-semibold text-[#eef4ff]">{formatPrice(low)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-semibold text-[#dce9ff]">52 Week Range</p>
            </div>
            <div className="min-w-0 text-right">
              <p className="font-semibold text-[#eef4ff]">{formatPrice(high)}</p>
            </div>
          </div>
        </>
      ) : (
        <div className="px-1 py-2 text-sm text-[#9fb1cc]">
          52-week range data is unavailable.
        </div>
      )}
    </div>
  );
}

export default function TopMoverDetailsModal({
  open = false,
  onClose,
  symbol = "",
  moverRow = null,
  loading = false,
  data = null,
  error = "",
  embedded = false,
  indexLabel = ""
}) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  const normalizedSymbol = String(symbol || moverRow?.symbol || "").trim().toUpperCase();
  const percentChange = asFiniteNumber(moverRow?.perChange, NaN);
  const quote = data?.quote || null;
  const deliveryTrend = Array.isArray(data?.deliveryTrend) ? data.deliveryTrend : [];
  const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
  const derivedSignals = useMemo(
    () => computeTopMoverSignals({ quote, deliveryTrend, moverRow }),
    [quote, deliveryTrend, moverRow]
  );

  if (!open) {
    return null;
  }

  const cardContent = (
    <div className={`relative flex w-full flex-col overflow-hidden ${embedded ? "h-full min-h-0 rounded-none bg-transparent shadow-none" : "max-h-[88vh] max-w-3xl rounded-2xl bg-[#060d17]/95 shadow-[0_16px_42px_-26px_rgba(0,0,0,0.7),inset_0_0_0_1px_rgba(255,255,255,0.05)]"}`}>
        <div className={`flex items-start justify-between gap-2 px-2.5 py-2 ${embedded ? "border-b border-white/[0.05]" : "border-b border-white/[0.06]"}`}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StockHeaderIcon symbol={normalizedSymbol} />
              <h3 className="text-base font-semibold tracking-[0.02em] text-white">{normalizedSymbol || "—"}</h3>
              <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${valueTextClass(percentChange)} bg-white/[0.04]`}>
                {Number.isFinite(percentChange) ? formatPercent(percentChange, 2) : "-"}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onClose?.()}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.03] text-[#cfe0f7] transition hover:bg-white/[0.07]"
          >
            ✕
          </button>
        </div>

        <div className={`min-h-0 overflow-auto ${embedded ? "p-2.5" : "p-2.5"}`}>
          {loading ? (
            <div className="space-y-2.5">
                <div className="rounded-lg bg-white/[0.02] p-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)]">
                  <SkeletonBlock className="mb-2 h-4 w-32" />
                  <SkeletonBlock className="h-2 w-full" />
                  <SkeletonBlock className="mt-6 h-12 w-full" />
                </div>
              <div className="rounded-lg bg-white/[0.02] p-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)]">
                <SkeletonBlock className="mb-2 h-4 w-64" />
                <SkeletonBlock className="h-40 w-full" />
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {error ? (
                <div className="rounded-lg bg-[#26161b]/85 px-3 py-2 text-xs text-[#ffb4c0] shadow-[inset_0_0_0_1px_rgba(255,115,138,0.15)]">
                  {error}
                </div>
              ) : null}

              {warnings.length ? (
                <div className="rounded-lg bg-[#241d12]/85 px-3 py-2 text-xs text-[#efca95] shadow-[inset_0_0_0_1px_rgba(238,170,70,0.14)]">
                  {warnings[0]}
                </div>
              ) : null}

              {!data ? (
                <div className="rounded-lg bg-white/[0.02] px-3 py-5 text-sm text-[#9fb1cc] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)]">
                  Stock details are unavailable for the selected symbol.
                </div>
              ) : null}

              {data ? (
                <>
                  <div className="space-y-2">
                    <RangeSlider52W quote={quote} />
                    <div className="h-px bg-white/[0.05]" />
                    <DeliveryTrendChart rows={deliveryTrend} />
                    <div className="h-px bg-white/[0.05]" />
                  </div>
                  <div className="grid gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      <SemiGauge
                        value={derivedSignals.shortScore}
                        label="Short Term"
                        subtitle={`${formatNumber(derivedSignals.shortScore, 0)} / 100`}
                      />
                      <SemiGauge
                        value={derivedSignals.longScore}
                        label="Long Term"
                        subtitle={`${formatNumber(derivedSignals.longScore, 0)} / 100`}
                      />
                    </div>
                    <StrategyGrid signals={derivedSignals} />
                    <CompactFactsTable quote={quote} signals={derivedSignals} indexLabel={indexLabel} />
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
  );

  if (embedded) {
    return (
      <div className="h-full min-h-0">
        {cardContent}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4">
      <button
        type="button"
        aria-label="Close details"
        className="absolute inset-0 bg-[#02060b]/80 backdrop-blur-[2px]"
        onClick={() => onClose?.()}
      />

      <div className="relative z-10">
        {cardContent}
      </div>
    </div>
  );
}
