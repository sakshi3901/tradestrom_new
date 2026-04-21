"use client";

import { useMemo, useState } from "react";

function formatNumber(value, decimals = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(numeric);
}

function formatTimestamp(unixSeconds) {
  const numeric = Number(unixSeconds);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "-";
  }

  const date = new Date(numeric * 1000);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    timeStyle: "short",
    hour12: false,
    timeZone: "Asia/Kolkata"
  }).format(date);
}

function valueColorClass(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "text-[#c6d3e6]";
  }
  return numeric >= 0 ? "text-[#22d59c]" : "text-[#ff6b7d]";
}

function buildHeatStyle(pointToIndex, maxAbsPoint) {
  const value = Number(pointToIndex) || 0;
  const intensity = maxAbsPoint > 0 ? Math.min(Math.abs(value) / maxAbsPoint, 1) : 0;
  const alpha = 0.04 + intensity * 0.2;

  if (value > 0) {
    return {
      background: `linear-gradient(90deg, rgba(22, 163, 74, ${alpha}) 0%, rgba(22, 163, 74, ${alpha * 0.2}) 55%, rgba(4, 10, 18, 0) 100%)`
    };
  }
  if (value < 0) {
    return {
      background: `linear-gradient(90deg, rgba(239, 68, 68, ${alpha}) 0%, rgba(239, 68, 68, ${alpha * 0.2}) 55%, rgba(4, 10, 18, 0) 100%)`
    };
  }
  return { background: "transparent" };
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

function StockIcon({ symbol }) {
  const [failedIndex, setFailedIndex] = useState(0);
  const candidates = useMemo(() => getSymbolImageCandidates(symbol), [symbol]);
  const src = candidates[failedIndex] || null;

  if (src) {
    return (
      <img
        src={src}
        alt={String(symbol || "")}
        width={22}
        height={22}
        loading="lazy"
        className="h-[22px] w-[22px] shrink-0 rounded-full border border-white/15 bg-[#0b1422] object-cover shadow-[0_0_0_1px_rgba(255,255,255,0.03)]"
        onError={() => {
          setFailedIndex((previous) => previous + 1);
        }}
      />
    );
  }

  return (
    <div className={`inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${symbolBadgeClasses(symbol)} ring-1 ring-white/15`}>
      <span className="text-[8px] font-bold text-white">
        {String(symbol || "").replace(/[^A-Z]/gi, "").slice(0, 2).toUpperCase() || "?"}
      </span>
    </div>
  );
}

function MiniCandlePair({ positive = true }) {
  const up = positive;
  return (
    <div className="flex items-end gap-0.5">
      <div className="relative h-4 w-1">
        <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-[#86a4cc]/70" />
        <span className={`absolute bottom-1 left-0.5 right-0.5 h-2 rounded-[2px] ${up ? "bg-[#19d18f]" : "bg-[#ff5f73]"}`} />
      </div>
      <div className="relative h-5 w-1">
        <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-[#86a4cc]/70" />
        <span className={`absolute bottom-1 left-0.5 right-0.5 h-3 rounded-[2px] ${up ? "bg-[#ff5f73]" : "bg-[#19d18f]"}`} />
      </div>
    </div>
  );
}

export default function ContributionTable({
  rows,
  selectedCandle,
  timeframeLabel,
  tableMode = "candle",
  rangeMeta = null,
  onRowClick = null,
  activeSymbol = ""
}) {
  const isRangeMode = tableMode === "range";

  const sortedRows = useMemo(() => {
    const output = Array.isArray(rows) ? [...rows] : [];
    output.sort((a, b) => {
      const absDiff = Math.abs(Number(b.pointToIndex) || 0) - Math.abs(Number(a.pointToIndex) || 0);
      if (absDiff !== 0) {
        return absDiff;
      }
      return String(a.symbol || "").localeCompare(String(b.symbol || ""));
    });
    return output.slice(0, 20);
  }, [rows]);

  const maxAbsPoint = useMemo(
    () => sortedRows.reduce((max, row) => Math.max(max, Math.abs(Number(row.pointToIndex) || 0)), 0),
    [sortedRows]
  );
  const headerTimeText = isRangeMode && rangeMeta?.startTimestamp
    ? `Range ${formatTimestamp(rangeMeta.startTimestamp)} → ${formatTimestamp(rangeMeta.endTimestamp || selectedCandle?.timestamp)}`
    : `Selected ${formatTimestamp(selectedCandle?.timestamp)}`;

  return (
    <section className="flex h-full min-h-0 flex-col px-2.5 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7f93af]">Top Movers</p>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9cb1cf] text-right">
          {headerTimeText}
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] border-y border-white/[0.045] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8f9fb7]">
          <div>Symbol</div>
          <div className="text-left">Strength</div>
        </div>

        <div className="h-full min-h-0 flex-1 overflow-auto">
          {sortedRows.length ? (
            <div>
              {sortedRows.map((row) => {
                const pointValue = Number(row.pointToIndex) || 0;
                const pointValueAbs = Math.abs(pointValue);
                const pointIntensity = maxAbsPoint > 0 ? Math.min(pointValueAbs / maxAbsPoint, 1) : 0;
                const widthPct = Math.max(8, pointIntensity * 100);
                const isActive = String(activeSymbol || "").toUpperCase() === String(row.symbol || "").toUpperCase();
                const clickable = typeof onRowClick === "function";

                return (
                  <div
                    key={row.symbol}
                    className={`group/row grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-2 border-b border-white/[0.025] px-3 py-1.5 transition-colors duration-200 last:border-b-0 ${clickable ? "cursor-pointer hover:bg-white/[0.02]" : ""} ${isActive ? "bg-white/[0.03]" : ""}`}
                    style={buildHeatStyle(pointValue, maxAbsPoint)}
                    title={`${row.symbol} • Strength ${formatNumber(pointValueAbs, 3)}`}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => onRowClick(row) : undefined}
                    onKeyDown={clickable ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onRowClick(row);
                      }
                    } : undefined}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <StockIcon symbol={row.symbol} />
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-semibold tracking-[0.01em] text-[#ebf2ff]">{row.symbol}</p>
                      </div>
                      <div className="ml-auto pr-0.5">
                        <MiniCandlePair positive={pointValue >= 0} />
                      </div>
                    </div>

                    <div className="relative">
                      <div className="h-6 overflow-hidden">
                        <div
                          className="h-full rounded-md bg-[linear-gradient(180deg,#57b2ff,#2778df)] transition-all duration-300 motion-reduce:transition-none"
                          style={{
                            width: `${widthPct}%`,
                            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16)"
                          }}
                        />
                      </div>
                      <span className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 ${valueColorClass(pointValue)}`}>
                        {formatNumber(pointValueAbs, 2)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-5 text-center text-sm text-[#8ea5c6]">No rows available.</div>
          )}
        </div>
      </div>
    </section>
  );
}
