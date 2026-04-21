"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CrosshairMode, createChart } from "lightweight-charts";

const IST_TIME_ZONE = "Asia/Kolkata";
const IST_OFFSET_SECONDS = 5.5 * 60 * 60;
const DEFAULT_RANGE_CANDLES = 25;
const SELECTION_EDGE_PX = 10;

function formatNumber(value, decimals = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(numeric);
}

function formatSigned(value, decimals = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  const absolute = formatNumber(Math.abs(numeric), decimals);
  if (numeric > 0) {
    return `+${absolute}`;
  }
  if (numeric < 0) {
    return `-${absolute}`;
  }
  return absolute;
}

function formatPercent(value, decimals = 2) {
  return `${formatSigned(value, decimals)}%`;
}

function formatTimestamp(unixSeconds) {
  if (!unixSeconds) {
    return "-";
  }
  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
    timeZone: IST_TIME_ZONE
  }).format(date);
}

function formatAxisTimestamp(unixSeconds) {
  if (!unixSeconds) {
    return "";
  }
  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: IST_TIME_ZONE
  }).format(date);
}

function isBusinessDayObject(value) {
  return value && typeof value === "object" && "year" in value && "month" in value && "day" in value;
}

function toUnixSecondsFromChartTime(time) {
  if (typeof time === "number") {
    return time;
  }
  if (isBusinessDayObject(time)) {
    return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
  }
  return null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getTimeframeStepSeconds(timeframe) {
  const key = String(timeframe || "").toLowerCase().trim();
  if (key === "15m") {
    return 15 * 60;
  }
  if (key === "3m") {
    return 3 * 60;
  }
  return 60;
}

function getIstSessionRangeFromTimestamp(unixSeconds) {
  const seconds = Number(unixSeconds);
  const fallbackNowSeconds = Math.floor(Date.now() / 1000);
  const anchorSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : fallbackNowSeconds;

  const istDate = new Date((anchorSeconds + IST_OFFSET_SECONDS) * 1000);
  if (Number.isNaN(istDate.getTime())) {
    return null;
  }

  const year = istDate.getUTCFullYear();
  const month = istDate.getUTCMonth();
  const day = istDate.getUTCDate();

  return {
    from: Math.floor(Date.UTC(year, month, day, 3, 45, 0, 0) / 1000), // 09:15 IST
    to: Math.floor(Date.UTC(year, month, day, 10, 0, 0, 0) / 1000) // 15:30 IST
  };
}

function enforceSessionTimeScale(chart, candles) {
  if (!chart) {
    return;
  }

  const firstTimestamp = Number(candles?.[0]?.timestamp ?? candles?.[0]?.time);
  const range = getIstSessionRangeFromTimestamp(firstTimestamp);
  if (!range) {
    return;
  }

  try {
    const timeScale = chart.timeScale();
    timeScale.applyOptions({
      rightOffset: 0,
      fixLeftEdge: true,
      fixRightEdge: true,
      lockVisibleTimeRangeOnResize: true,
      shiftVisibleRangeOnNewBar: false
    });
    timeScale.setVisibleRange({
      from: range.from,
      to: range.to
    });
  } catch (_) {
    // Ignore transient range-application errors during resize/update.
  }
}

function padSeriesWithSessionNaN(seriesData, candles, chartType, timeframe) {
  const source = Array.isArray(seriesData) ? [...seriesData] : [];
  const firstTimestamp = Number(candles?.[0]?.timestamp ?? candles?.[0]?.time);
  const sessionRange = getIstSessionRangeFromTimestamp(firstTimestamp);
  if (!sessionRange) {
    return source;
  }

  const stepSeconds = Math.max(60, getTimeframeStepSeconds(timeframe));
  const rowByTime = new Map();

  for (const row of source) {
    const time = Number(row?.time ?? row?.timestamp);
    if (!Number.isFinite(time)) {
      continue;
    }
    rowByTime.set(time, {
      ...row,
      time
    });
  }

  const padded = [];
  for (let time = sessionRange.from; time <= sessionRange.to; time += stepSeconds) {
    const existing = rowByTime.get(time);
    if (existing) {
      padded.push(existing);
      continue;
    }

    if (chartType === "line" || chartType === "area") {
      padded.push({
        time,
        value: Number.NaN
      });
      continue;
    }

    padded.push({
      time,
      open: Number.NaN,
      high: Number.NaN,
      low: Number.NaN,
      close: Number.NaN
    });
  }

  return padded;
}

function getSeriesData(candles, chartType = "candlestick", timeframe = "1m") {
  const source = Array.isArray(candles) ? candles : [];
  if (chartType === "line" || chartType === "area") {
    const lineData = source
      .map((candle) => {
        const time = candle?.time ?? candle?.timestamp;
        const value = Number(candle?.close);
        if (!time || !Number.isFinite(value)) {
          return null;
        }
        return { time, value };
      })
      .filter(Boolean);
    return padSeriesWithSessionNaN(lineData, source, chartType, timeframe);
  }
  const candleData = source
    .map((candle) => {
      const time = Number(candle?.time ?? candle?.timestamp);
      if (!Number.isFinite(time)) {
        return null;
      }
      return {
        ...candle,
        time
      };
    })
    .filter(Boolean);
  return padSeriesWithSessionNaN(candleData, source, chartType, timeframe);
}

function addSeriesForChartType(chart, chartType = "candlestick") {
  if (!chart) {
    return null;
  }

  if (chartType === "line" && typeof chart.addLineSeries === "function") {
    return chart.addLineSeries({
      color: "#57b2ff",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
      crosshairMarkerBackgroundColor: "#57b2ff",
      crosshairMarkerBorderColor: "#0f1a2a",
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.05
      }
    });
  }

  if (chartType === "area" && typeof chart.addAreaSeries === "function") {
    return chart.addAreaSeries({
      lineColor: "#4ea7ff",
      topColor: "rgba(78, 167, 255, 0.28)",
      bottomColor: "rgba(78, 167, 255, 0.02)",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
      crosshairMarkerBackgroundColor: "#4ea7ff",
      crosshairMarkerBorderColor: "#0f1a2a",
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.05
      }
    });
  }

  return chart.addCandlestickSeries({
    upColor: "#19d18f",
    downColor: "#ff5f73",
    borderVisible: false,
    wickUpColor: "#19d18f",
    wickDownColor: "#ff5f73",
    priceLineColor: "#5eb8ff",
    lastValueVisible: false,
    priceLineVisible: false,
    priceFormat: {
      type: "price",
      precision: 2,
      minMove: 0.05
    }
  });
}

function findNearestCandleIndex(candles, targetTimestamp) {
  if (!Array.isArray(candles) || candles.length === 0 || !Number.isFinite(targetTimestamp)) {
    return null;
  }

  let low = 0;
  let high = candles.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = Number(candles[mid]?.timestamp ?? candles[mid]?.time);
    if (!Number.isFinite(value)) {
      return null;
    }
    if (value === targetTimestamp) {
      return mid;
    }
    if (value < targetTimestamp) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (low <= 0) {
    return 0;
  }
  if (low >= candles.length) {
    return candles.length - 1;
  }

  const leftTimestamp = Number(candles[low - 1]?.timestamp ?? candles[low - 1]?.time);
  const rightTimestamp = Number(candles[low]?.timestamp ?? candles[low]?.time);
  if (!Number.isFinite(leftTimestamp)) {
    return low;
  }
  if (!Number.isFinite(rightTimestamp)) {
    return low - 1;
  }

  return Math.abs(rightTimestamp - targetTimestamp) < Math.abs(leftTimestamp - targetTimestamp)
    ? low
    : low - 1;
}

export default function NiftyChart({
  candles,
  selectedCandle,
  selectedTimestamp,
  selectionMode = "range",
  compactMode = false,
  indexValue = "nifty50",
  indexOptions = [],
  onIndexChange,
  chartType = "candlestick",
  chartTypeOptions = [],
  onChartTypeChange,
  timeframe,
  timeframeOptions,
  onTimeframeChange,
  onSelectionModeChange,
  onSelectTimestamp,
  onRangeSelectionChange,
  isPending,
  onExecute,
  executeDisabled = false,
  executeLoading = false
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const seriesTypeRef = useRef("candlestick");
  const hasSeriesDataRef = useRef(false);
  const candlesRef = useRef(candles);
  const selectionHandlerRef = useRef(onSelectTimestamp);
  const rangeChangeHandlerRef = useRef(onRangeSelectionChange);
  const selectionModeRef = useRef(selectionMode);
  const dragStateRef = useRef({
    mode: "idle",
    anchorIndex: null,
    baseStart: null,
    baseEnd: null,
    moved: false
  });

  const [rangeSelection, setRangeSelection] = useState(null);
  const [isDraggingRange, setIsDraggingRange] = useState(false);
  const [hoverMode, setHoverMode] = useState("idle");
  const [overlayTick, setOverlayTick] = useState(0);
  const isRangeSelectorMode = selectionMode === "range";
  const isCompact = Boolean(compactMode);
  const activeIndexLabel = useMemo(() => {
    const option = Array.isArray(indexOptions)
      ? indexOptions.find((item) => item?.value === indexValue)
      : null;
    return option?.label || "Nifty50";
  }, [indexOptions, indexValue]);

  useEffect(() => {
    selectionHandlerRef.current = onSelectTimestamp;
  }, [onSelectTimestamp]);

  useEffect(() => {
    rangeChangeHandlerRef.current = onRangeSelectionChange;
  }, [onRangeSelectionChange]);

  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  const getCandleCenters = useCallback(() => {
    if (!Array.isArray(candles) || candles.length === 0) {
      return [];
    }

    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container) {
      return [];
    }

    const timeScale = chart.timeScale?.();
    if (!timeScale) {
      return [];
    }

    if (typeof timeScale.logicalToCoordinate === "function") {
      const logicalCenters = [];
      let canUseLogical = true;
      for (let index = 0; index < candles.length; index += 1) {
        const coordinate = Number(timeScale.logicalToCoordinate(index));
        if (!Number.isFinite(coordinate)) {
          canUseLogical = false;
          break;
        }
        logicalCenters.push(coordinate);
      }
      if (canUseLogical && logicalCenters.length === candles.length) {
        return logicalCenters;
      }
    }

    if (typeof timeScale.timeToCoordinate !== "function") {
      return [];
    }

    const centers = [];
    let canUseProjection = true;
    for (const candle of candles) {
      const chartTime = candle?.time ?? candle?.timestamp;
      const coordinate = Number(timeScale.timeToCoordinate(chartTime));
      if (!Number.isFinite(coordinate)) {
        canUseProjection = false;
        break;
      }
      centers.push(coordinate);
    }

    if (canUseProjection && centers.length === candles.length) {
      return centers;
    }

    const width = container.getBoundingClientRect().width;
    if (!Number.isFinite(width) || width <= 0) {
      return [];
    }

    const step = width / Math.max(candles.length, 1);
    return Array.from({ length: candles.length }, (_, index) => (index * step) + (step / 2));
  }, [candles]);

  const getCandlePixelWidth = useCallback(() => {
    const centers = getCandleCenters();
    if (centers.length === 0) {
      return 8;
    }
    if (centers.length === 1) {
      return 10;
    }

    let spacing = 0;
    for (let index = 1; index < centers.length; index += 1) {
      spacing += Math.abs(centers[index] - centers[index - 1]);
    }
    return Math.max(spacing / (centers.length - 1), 4);
  }, [getCandleCenters]);

  const getIndexFromClientX = useCallback((clientX) => {
    const container = containerRef.current;
    if (!container || !Array.isArray(candles) || candles.length === 0) {
      return null;
    }

    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    if (x < 0 || x > rect.width) {
      return null;
    }

    const chart = chartRef.current;
    const timeScale = chart?.timeScale?.();
    if (timeScale && typeof timeScale.coordinateToTime === "function") {
      const chartTime = timeScale.coordinateToTime(x);
      const unixSeconds = toUnixSecondsFromChartTime(chartTime);
      const nearestIndex = findNearestCandleIndex(candles, unixSeconds);
      if (nearestIndex !== null) {
        return clamp(nearestIndex, 0, candles.length - 1);
      }
    }

    const centers = getCandleCenters();
    if (centers.length === 0) {
      return null;
    }

    let nearestIndex = 0;
    let bestDistance = Math.abs(centers[0] - x);
    for (let index = 1; index < centers.length; index += 1) {
      const distance = Math.abs(centers[index] - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearestIndex = index;
      }
    }

    return clamp(nearestIndex, 0, candles.length - 1);
  }, [candles, getCandleCenters]);

  const getSelectionPixelBounds = useCallback((targetSelection) => {
    if (!targetSelection) {
      return null;
    }

    const chart = chartRef.current;
    const timeScale = chart?.timeScale?.();
    const startCandle = targetSelection.startCandle || candles?.[targetSelection.startIndex];
    const endCandle = targetSelection.endCandle || candles?.[targetSelection.endIndex];
    const startTime = startCandle?.time ?? startCandle?.timestamp;
    const endTime = endCandle?.time ?? endCandle?.timestamp;

    let leftCenter = NaN;
    let rightCenter = NaN;
    if (timeScale && typeof timeScale.timeToCoordinate === "function" && startTime && endTime) {
      leftCenter = Number(timeScale.timeToCoordinate(startTime));
      rightCenter = Number(timeScale.timeToCoordinate(endTime));
    }

    if (!Number.isFinite(leftCenter) || !Number.isFinite(rightCenter)) {
      const centers = getCandleCenters();
      if (centers.length === 0) {
        return null;
      }
      leftCenter = centers[targetSelection.startIndex];
      rightCenter = centers[targetSelection.endIndex];
    }

    if (!Number.isFinite(leftCenter) || !Number.isFinite(rightCenter)) {
      return null;
    }

    const candleWidth = getCandlePixelWidth();
    return {
      start: Math.min(leftCenter, rightCenter) - (candleWidth / 2),
      end: Math.max(leftCenter, rightCenter) + (candleWidth / 2)
    };
  }, [candles, getCandleCenters, getCandlePixelWidth]);

  const getInteractionMode = useCallback((clientX, candleIndex) => {
    if (!rangeSelection || !containerRef.current) {
      return "new";
    }

    const normalizedStart = Math.min(rangeSelection.startIndex, rangeSelection.endIndex);
    const normalizedEnd = Math.max(rangeSelection.startIndex, rangeSelection.endIndex);
    const bounds = getSelectionPixelBounds({
      startIndex: normalizedStart,
      endIndex: normalizedEnd
    });
    if (!bounds) {
      return "new";
    }

    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    if (Math.abs(x - bounds.start) <= SELECTION_EDGE_PX) {
      return "resize-left";
    }
    if (Math.abs(x - bounds.end) <= SELECTION_EDGE_PX) {
      return "resize-right";
    }
    if (x > bounds.start && x < bounds.end) {
      if (candleIndex === normalizedStart || candleIndex === normalizedEnd) {
        return "new";
      }
      return "move";
    }
    return "new";
  }, [getSelectionPixelBounds, rangeSelection]);

  const normalizedRange = useMemo(() => {
    if (!rangeSelection || !Array.isArray(candles) || candles.length < 2) {
      return null;
    }
    const startIndex = Math.min(rangeSelection.startIndex, rangeSelection.endIndex);
    const endIndex = Math.max(rangeSelection.startIndex, rangeSelection.endIndex);
    if (startIndex < 0 || endIndex >= candles.length || startIndex === endIndex) {
      return null;
    }
    return {
      startIndex,
      endIndex,
      count: endIndex - startIndex + 1,
      startCandle: candles[startIndex],
      endCandle: candles[endIndex]
    };
  }, [candles, rangeSelection]);

  const selectionBox = useMemo(() => {
    if (!normalizedRange) {
      return null;
    }
    const bounds = getSelectionPixelBounds(normalizedRange);
    if (!bounds) {
      return null;
    }
    const container = containerRef.current;
    const containerWidth = Number(container?.getBoundingClientRect?.().width || 0);
    const rawLeft = bounds.start;
    const rawRight = bounds.end;
    if (!Number.isFinite(rawLeft) || !Number.isFinite(rawRight)) {
      return null;
    }

    const clampedLeft = containerWidth > 0 ? clamp(rawLeft, 0, containerWidth) : rawLeft;
    const clampedRight = containerWidth > 0 ? clamp(rawRight, 0, containerWidth) : rawRight;
    const labelHalfWidth = 26;
    const startLabelX = containerWidth > 0 ? clamp(clampedLeft, labelHalfWidth, Math.max(containerWidth - labelHalfWidth, labelHalfWidth)) : clampedLeft;
    const endLabelX = containerWidth > 0 ? clamp(clampedRight, labelHalfWidth, Math.max(containerWidth - labelHalfWidth, labelHalfWidth)) : clampedRight;
    return {
      startX: clampedLeft,
      endX: clampedRight,
      startLabelX,
      endLabelX,
      left: clampedLeft,
      width: Math.max(clampedRight - clampedLeft, 2)
    };
  }, [getSelectionPixelBounds, normalizedRange, overlayTick]);

  const selectedCandleMarker = useMemo(() => {
    if (!Number.isFinite(Number(selectedTimestamp))) {
      return null;
    }

    const chart = chartRef.current;
    const timeScale = chart?.timeScale?.();
    let x = NaN;
    if (timeScale && typeof timeScale.timeToCoordinate === "function") {
      x = Number(timeScale.timeToCoordinate(Number(selectedTimestamp)));
    }

    if (!Number.isFinite(x)) {
      const index = findNearestCandleIndex(candles, Number(selectedTimestamp));
      if (index === null) {
        return null;
      }
      const centers = getCandleCenters();
      x = Number(centers[index]);
    }

    if (!Number.isFinite(x)) {
      return null;
    }

    const containerWidth = Number(containerRef.current?.getBoundingClientRect?.().width || 0);
    const clampedX = containerWidth > 0 ? clamp(x, 0, containerWidth) : x;
    const labelHalfWidth = 26;
    const labelX = containerWidth > 0 ? clamp(clampedX, labelHalfWidth, Math.max(containerWidth - labelHalfWidth, labelHalfWidth)) : clampedX;
    return {
      x: clampedX,
      labelX,
      label: formatAxisTimestamp(Number(selectedTimestamp))
    };
  }, [candles, getCandleCenters, overlayTick, selectedTimestamp]);

  const interactionCursorClass = isDraggingRange
    ? (dragStateRef.current.mode === "move"
      ? "cursor-grabbing"
      : (dragStateRef.current.mode === "resize-left" || dragStateRef.current.mode === "resize-right"
        ? "cursor-ew-resize"
        : "cursor-crosshair"))
    : (hoverMode === "move"
      ? "cursor-grab"
      : (hoverMode === "resize-left" || hoverMode === "resize-right" ? "cursor-ew-resize" : "cursor-crosshair"));

  useEffect(() => {
    setRangeSelection((previous) => {
      if (!Array.isArray(candles) || candles.length < 2) {
        return null;
      }

      if (!previous) {
        return {
          startIndex: 0,
          endIndex: Math.min(DEFAULT_RANGE_CANDLES - 1, candles.length - 1)
        };
      }

      const safeStart = clamp(previous.startIndex, 0, candles.length - 1);
      const safeEnd = clamp(previous.endIndex, 0, candles.length - 1);
      if (safeStart === safeEnd) {
        return {
          startIndex: Math.max(safeStart - 1, 0),
          endIndex: safeStart
        };
      }
      return {
        startIndex: safeStart,
        endIndex: safeEnd
      };
    });
  }, [candles]);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    const container = containerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 360,
      layout: {
        background: { color: "rgba(0,0,0,0)" },
        textColor: "#b9c7db",
        attributionLogo: false
      },
      localization: {
        locale: "en-IN",
        timeFormatter: (chartTime) => {
          const unixSeconds = toUnixSecondsFromChartTime(chartTime);
          return formatTimestamp(unixSeconds);
        }
      },
      grid: {
        vertLines: { color: "rgba(125, 171, 230, 0.045)" },
        horzLines: { color: "rgba(125, 171, 230, 0.045)" }
      },
      rightPriceScale: {
        visible: false
      },
      leftPriceScale: {
        visible: false
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.06)",
        timeVisible: true,
        secondsVisible: timeframe === "1m",
        rightOffset: 0,
        fixLeftEdge: true,
        fixRightEdge: true,
        shiftVisibleRangeOnNewBar: false,
        lockVisibleTimeRangeOnResize: true,
        tickMarkFormatter: (chartTime) => {
          const unixSeconds = toUnixSecondsFromChartTime(chartTime);
          return formatAxisTimestamp(unixSeconds);
        }
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(88, 189, 255, 0.45)",
          width: 1,
          style: 2,
          visible: true,
          labelVisible: true
        },
        horzLine: {
          color: "rgba(88, 189, 255, 0.28)",
          width: 1,
          style: 2,
          visible: true,
          labelVisible: false
        }
      },
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: false,
        horzTouchDrag: false,
        vertTouchDrag: false
      },
      handleScale: {
        axisPressedMouseMove: false,
        mouseWheel: false,
        pinch: false
      }
    });

    const series = addSeriesForChartType(chart, chartType);

    chartRef.current = chart;
    seriesRef.current = series;
    seriesTypeRef.current = chartType;

    const pushSelectionFromCrosshair = (param) => {
      if (!param || param.point === undefined || !param.time) {
        return;
      }

      const activeSeries = seriesRef.current;
      const candleData = activeSeries ? param.seriesData?.get?.(activeSeries) : null;
      if (!candleData) {
        return;
      }

      const unixSeconds = toUnixSecondsFromChartTime(param.time);
      if (!Number.isFinite(unixSeconds)) {
        return;
      }

      if (selectionModeRef.current === "range" && selectionHandlerRef.current) {
        selectionHandlerRef.current(unixSeconds);
      }
    };

    chart.subscribeCrosshairMove(pushSelectionFromCrosshair);

    const handleChartClick = (param) => {
      if (selectionModeRef.current !== "single") {
        return;
      }
      if (!param || !param.time) {
        return;
      }
      const unixSeconds = toUnixSecondsFromChartTime(param.time);
      if (!Number.isFinite(unixSeconds)) {
        return;
      }
      if (selectionHandlerRef.current) {
        selectionHandlerRef.current(unixSeconds);
      }
    };

    chart.subscribeClick(handleChartClick);

    const timeScale = chart.timeScale();
    const handleVisibleRangeChange = () => {
      setOverlayTick((previous) => previous + 1);
    };
    if (timeScale && typeof timeScale.subscribeVisibleLogicalRangeChange === "function") {
      timeScale.subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
    }

    let resizeObserver = null;
	    if (typeof ResizeObserver !== "undefined") {
	      resizeObserver = new ResizeObserver((entries) => {
	        const entry = entries[0];
	        if (!entry || !chartRef.current) {
	          return;
	        }
        const { width, height } = entry.contentRect;
	        chartRef.current.applyOptions({
	          width: Math.max(280, Math.floor(width)),
	          height: Math.max(220, Math.floor(height))
	        });
          if (hasSeriesDataRef.current) {
            enforceSessionTimeScale(chartRef.current, candlesRef.current);
          }
	        setOverlayTick((previous) => previous + 1);
	      });
	      resizeObserver.observe(container);
	    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (timeScale && typeof timeScale.unsubscribeVisibleLogicalRangeChange === "function") {
        timeScale.unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      }
      chart.unsubscribeCrosshairMove(pushSelectionFromCrosshair);
      chart.unsubscribeClick(handleChartClick);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      seriesTypeRef.current = "candlestick";
      hasSeriesDataRef.current = false;
    };
  // Create the chart shell once; series type changes are handled in a separate effect.
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }

    if (seriesRef.current && seriesTypeRef.current === chartType) {
      return;
    }

    if (seriesRef.current) {
      try {
        if (typeof chart.removeSeries === "function") {
          chart.removeSeries(seriesRef.current);
        }
      } catch (_) {
        // Ignore stale series handles.
      }
    }

    const nextSeries = addSeriesForChartType(chart, chartType);
    seriesRef.current = nextSeries;
    seriesTypeRef.current = chartType;

    if (nextSeries) {
      nextSeries.setData(getSeriesData(candles, chartType, timeframe));
      hasSeriesDataRef.current = true;
    }

    enforceSessionTimeScale(chart, candles);
    setOverlayTick((previous) => previous + 1);
  }, [candles, chartType, timeframe]);

  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) {
      return;
    }

    chartRef.current.applyOptions({
      timeScale: {
        borderColor: "rgba(125, 171, 230, 0.14)",
        timeVisible: true,
        secondsVisible: timeframe === "1m",
        rightOffset: 0,
        fixLeftEdge: true,
        fixRightEdge: true,
        shiftVisibleRangeOnNewBar: false,
        lockVisibleTimeRangeOnResize: true,
        tickMarkFormatter: (chartTime) => {
          const unixSeconds = toUnixSecondsFromChartTime(chartTime);
          return formatAxisTimestamp(unixSeconds);
        }
      }
    });

	    seriesRef.current.setData(getSeriesData(candles, chartType, timeframe));
    hasSeriesDataRef.current = true;
    enforceSessionTimeScale(chartRef.current, candles);
    setOverlayTick((previous) => previous + 1);
  }, [candles, timeframe, chartType]);

  const handleRangePointerDown = useCallback((event) => {
    if (!Array.isArray(candles) || candles.length === 0) {
      return;
    }

    const index = getIndexFromClientX(event.clientX);
    if (index === null) {
      return;
    }

    const mode = getInteractionMode(event.clientX, index);
    const currentStart = rangeSelection ? Math.min(rangeSelection.startIndex, rangeSelection.endIndex) : null;
    const currentEnd = rangeSelection ? Math.max(rangeSelection.startIndex, rangeSelection.endIndex) : null;

    dragStateRef.current = {
      mode,
      anchorIndex: index,
      baseStart: currentStart,
      baseEnd: currentEnd,
      moved: false
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDraggingRange(true);
    setHoverMode(mode);

    if (mode === "new" || currentStart === null || currentEnd === null) {
      setRangeSelection({
        startIndex: index,
        endIndex: index
      });
    }

    const hoverCandle = candles[index];
    const hoverTimestamp = Number(hoverCandle?.timestamp ?? hoverCandle?.time);
    const containerRect = containerRef.current?.getBoundingClientRect?.();
    const yCoordinate = containerRect ? (event.clientY - containerRect.top) : NaN;
    const chart = chartRef.current;
    const series = seriesRef.current;
    const priceFromPointer = series && Number.isFinite(yCoordinate) && typeof series.coordinateToPrice === "function"
      ? Number(series.coordinateToPrice(yCoordinate))
      : NaN;
    const fallbackPrice = Number(hoverCandle?.close ?? hoverCandle?.open);
    const crosshairPrice = Number.isFinite(priceFromPointer)
      ? priceFromPointer
      : (Number.isFinite(fallbackPrice) ? fallbackPrice : 0);
    if (chart && series && typeof chart.setCrosshairPosition === "function" && Number.isFinite(hoverTimestamp)) {
      chart.setCrosshairPosition(crosshairPrice, hoverTimestamp, series);
    }
  }, [candles, getIndexFromClientX, getInteractionMode, rangeSelection]);

  const handleRangePointerMove = useCallback((event) => {
    const index = getIndexFromClientX(event.clientX);
    if (index === null) {
      const chart = chartRef.current;
      if (chart && typeof chart.clearCrosshairPosition === "function") {
        chart.clearCrosshairPosition();
      }
      return;
    }

    const hoverCandle = candles[index];
    const hoverTimestamp = Number(hoverCandle?.timestamp ?? hoverCandle?.time);
    const containerRect = containerRef.current?.getBoundingClientRect?.();
    const yCoordinate = containerRect ? (event.clientY - containerRect.top) : NaN;
    const chart = chartRef.current;
    const series = seriesRef.current;
    const priceFromPointer = series && Number.isFinite(yCoordinate) && typeof series.coordinateToPrice === "function"
      ? Number(series.coordinateToPrice(yCoordinate))
      : NaN;
    const fallbackPrice = Number(hoverCandle?.close ?? hoverCandle?.open);
    const crosshairPrice = Number.isFinite(priceFromPointer)
      ? priceFromPointer
      : (Number.isFinite(fallbackPrice) ? fallbackPrice : 0);
    if (chart && series && typeof chart.setCrosshairPosition === "function" && Number.isFinite(hoverTimestamp)) {
      chart.setCrosshairPosition(crosshairPrice, hoverTimestamp, series);
    }
    if (Number.isFinite(hoverTimestamp) && selectionHandlerRef.current) {
      selectionHandlerRef.current(hoverTimestamp);
    }

    if (!isDraggingRange) {
      setHoverMode(getInteractionMode(event.clientX, index));
      return;
    }

    const drag = dragStateRef.current;
    if (!drag || drag.mode === "idle") {
      return;
    }

    if (drag.anchorIndex !== null && drag.anchorIndex !== index) {
      dragStateRef.current = {
        ...drag,
        moved: true
      };
    }

    setRangeSelection((previous) => {
      if (!previous && drag.mode !== "new") {
        return previous;
      }

      const prevStart = previous ? Math.min(previous.startIndex, previous.endIndex) : index;
      const prevEnd = previous ? Math.max(previous.startIndex, previous.endIndex) : index;

      if (drag.mode === "new") {
        return {
          startIndex: drag.anchorIndex ?? index,
          endIndex: index
        };
      }

      if (drag.mode === "resize-left") {
        const fixedEnd = drag.baseEnd ?? prevEnd;
        const nextStart = clamp(index, 0, Math.max(fixedEnd - 1, 0));
        return {
          startIndex: nextStart,
          endIndex: fixedEnd
        };
      }

      if (drag.mode === "resize-right") {
        const fixedStart = drag.baseStart ?? prevStart;
        const nextEnd = clamp(index, Math.min(fixedStart + 1, candles.length - 1), candles.length - 1);
        return {
          startIndex: fixedStart,
          endIndex: nextEnd
        };
      }

      if (drag.mode === "move") {
        const fixedStart = drag.baseStart ?? prevStart;
        const fixedEnd = drag.baseEnd ?? prevEnd;
        const width = fixedEnd - fixedStart;
        const delta = index - (drag.anchorIndex ?? index);
        const maxStart = Math.max(candles.length - 1 - width, 0);
        const nextStart = clamp(fixedStart + delta, 0, maxStart);
        return {
          startIndex: nextStart,
          endIndex: nextStart + width
        };
      }

      return previous;
    });
  }, [candles, candles.length, getIndexFromClientX, getInteractionMode, isDraggingRange]);

  const endRangePointerDrag = useCallback((event) => {
    const drag = dragStateRef.current;
    const clickedIndex = getIndexFromClientX(event.clientX);
    const shouldSelectCandle = drag?.mode === "new" && !drag?.moved && clickedIndex !== null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragStateRef.current = {
      mode: "idle",
      anchorIndex: null,
      baseStart: null,
      baseEnd: null,
      moved: false
    };
    setIsDraggingRange(false);
    setHoverMode("idle");

    if (shouldSelectCandle && Number.isInteger(drag?.baseStart) && Number.isInteger(drag?.baseEnd) && drag.baseStart !== drag.baseEnd) {
      setRangeSelection({
        startIndex: drag.baseStart,
        endIndex: drag.baseEnd
      });
    }

  }, [candles, getIndexFromClientX]);

  const changeIsPositive = (selectedCandle?.pointChange || 0) >= 0;
  const changeColorClass = changeIsPositive ? "text-[#22d59c]" : "text-[#ff6b7d]";
  const rangeSummary = normalizedRange
    ? `${formatTimestamp(normalizedRange.startCandle?.timestamp)} to ${formatTimestamp(normalizedRange.endCandle?.timestamp)}`
    : "Drag on chart to select a range";

  useEffect(() => {
    if (!rangeChangeHandlerRef.current) {
      return;
    }

    if (!isRangeSelectorMode || !normalizedRange) {
      rangeChangeHandlerRef.current(null);
      return;
    }

    rangeChangeHandlerRef.current({
      startIndex: normalizedRange.startIndex,
      endIndex: normalizedRange.endIndex,
      count: normalizedRange.count,
      startTimestamp: Number(normalizedRange.startCandle?.timestamp ?? normalizedRange.startCandle?.time) || null,
      endTimestamp: Number(normalizedRange.endCandle?.timestamp ?? normalizedRange.endCandle?.time) || null
    });
  }, [isRangeSelectorMode, normalizedRange]);

  return (
    <section className={`flex h-full min-h-0 flex-col ${isCompact ? "px-1 py-1" : "px-1.5 py-1.5"}`}>
      <div className={`${isCompact ? "mb-1 pb-1" : "mb-1.5 pb-1"} flex flex-wrap items-center justify-between gap-1.5 border-b border-white/[0.05]`}>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ba0be]">{activeIndexLabel}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <h2 className={`${isCompact ? "text-[15px]" : "text-base sm:text-lg"} font-semibold text-white`}>Chart</h2>
            {isPending ? (
              <span className="rounded-full bg-[#0f2022] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#56d8cd] shadow-[inset_0_0_0_1px_rgba(86,216,205,0.14)]">
                Updating…
              </span>
            ) : null}
          </div>
          {!isCompact ? (
            <p className="mt-1.5 text-[11px] text-[#8ea5c6] transition-colors duration-300 motion-reduce:transition-none">
              {isRangeSelectorMode
                ? "Hover to move the crosshair candle selector. Drag on the chart to create/resize/move a range selector. Time shown in IST."
                : "Hover a candle to move the crosshair selector. Single-candle selector mode is active. Time shown in IST."}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <label className="flex items-center gap-1.5 rounded-lg bg-white/[0.02] px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9bb2d4] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
            <span>Index</span>
            <select
              value={indexValue}
              onChange={(event) => onIndexChange?.(event.target.value)}
              className="rounded-md bg-[#081322]/95 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-white outline-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] focus:shadow-[inset_0_0_0_1px_rgba(77,135,199,0.45)]"
            >
              {Array.isArray(indexOptions) && indexOptions.length ? indexOptions.map((option) => (
                <option key={option.value} value={option.value} disabled={Boolean(option.disabled)}>
                  {option.label}
                </option>
              )) : (
                <option value="nifty50">Nifty50</option>
              )}
            </select>
          </label>

          <label className="flex items-center gap-1.5 rounded-lg bg-white/[0.02] px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9bb2d4] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
            <span>Chart</span>
            <select
              value={chartType}
              onChange={(event) => onChartTypeChange?.(event.target.value)}
              className="rounded-md bg-[#081322]/95 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-white outline-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] focus:shadow-[inset_0_0_0_1px_rgba(77,135,199,0.45)]"
            >
              {Array.isArray(chartTypeOptions) && chartTypeOptions.length ? chartTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              )) : (
                <option value="candlestick">Candlestick</option>
              )}
            </select>
          </label>

          <label className="flex items-center gap-1.5 rounded-lg bg-white/[0.02] px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9bb2d4] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
            <span>Selector</span>
            <select
              value={selectionMode}
              onChange={(event) => onSelectionModeChange?.(event.target.value)}
              className="rounded-md bg-[#081322]/95 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-white outline-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] focus:shadow-[inset_0_0_0_1px_rgba(77,135,199,0.45)]"
            >
              <option value="single">Single Candle</option>
              <option value="range">Range Selector</option>
            </select>
          </label>

          <div className="flex flex-wrap items-center gap-0.5 rounded-lg bg-white/[0.02] p-0.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
          {timeframeOptions.map((option) => {
            const isActive = option.value === timeframe;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onTimeframeChange(option.value)}
                className={[
                  "rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] transition",
                  "motion-reduce:transition-none",
                  isActive
                    ? "bg-[#12243b] text-white shadow-[inset_0_0_0_1px_rgba(102,180,255,0.18)]"
                    : "text-[#9bb2d4] hover:bg-white/[0.03] hover:text-white"
                ].join(" ")}
                aria-pressed={isActive}
              >
                {option.label}
              </button>
            );
          })}
          </div>

          {typeof onExecute === "function" ? (
            <button
              type="button"
              onClick={onExecute}
              disabled={Boolean(executeDisabled)}
              className="inline-flex items-center justify-center rounded-lg bg-[#1458df] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white transition hover:bg-[#1b65fb] disabled:cursor-not-allowed disabled:opacity-45 shadow-[0_8px_22px_-14px_rgba(36,94,204,0.65),inset_0_0_0_1px_rgba(126,176,255,0.2)]"
            >
              {executeLoading ? "Executing…" : "Execute"}
            </button>
          ) : null}
          <Link
            href="/videos"
            className="inline-flex items-center justify-center rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#d7e7ff] transition hover:bg-white/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
          >
            Videos
          </Link>
          <Link
            href="/community"
            className="inline-flex items-center justify-center rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#d7e7ff] transition hover:bg-white/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
          >
            Community
          </Link>
          <Link
            href="/admin"
            className="inline-flex items-center justify-center rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#d7e7ff] transition hover:bg-white/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
          >
            Admin Dashboard
          </Link>
        </div>
      </div>

      {!isCompact ? (
      <div className={`grid gap-2 sm:grid-cols-2 ${isRangeSelectorMode ? "lg:grid-cols-6" : "lg:grid-cols-5"}`}>
        <div className="rounded-xl border border-[#20344f] bg-[#0b1728] px-2.5 py-2.5 transition-colors duration-300 motion-reduce:transition-none">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[#7f94b2]">Selected Time</p>
          <p className="mt-1 text-sm font-medium text-white">{formatTimestamp(selectedCandle?.timestamp)}</p>
        </div>
        <div className="rounded-xl border border-[#20344f] bg-[#0b1728] px-2.5 py-2.5 transition-colors duration-300 motion-reduce:transition-none">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[#7f94b2]">OHLC</p>
          <p className="mt-1 text-sm font-medium text-white">
            {formatNumber(selectedCandle?.open)} / {formatNumber(selectedCandle?.high)} / {formatNumber(selectedCandle?.low)} / {formatNumber(selectedCandle?.close)}
          </p>
        </div>
        <div className="rounded-xl border border-[#20344f] bg-[#0b1728] px-2.5 py-2.5 transition-colors duration-300 motion-reduce:transition-none">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[#7f94b2]">Index Change (Pts)</p>
          <p className={`mt-1 text-sm font-semibold ${changeColorClass}`}>{formatSigned(selectedCandle?.pointChange, 2)}</p>
        </div>
        <div className="rounded-xl border border-[#20344f] bg-[#0b1728] px-2.5 py-2.5 transition-colors duration-300 motion-reduce:transition-none">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[#7f94b2]">Index Change (%)</p>
          <p className={`mt-1 text-sm font-semibold ${changeColorClass}`}>{formatPercent(selectedCandle?.percentChange, 3)}</p>
        </div>
        <div className="rounded-xl border border-[#20344f] bg-[#0b1728] px-2.5 py-2.5 transition-colors duration-300 motion-reduce:transition-none">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[#7f94b2]">Prev Close (Ref)</p>
          <p className="mt-1 text-sm font-medium text-white">{formatNumber(selectedCandle?.previousClose)}</p>
        </div>
        {isRangeSelectorMode ? (
          <div className="rounded-xl border border-[#20344f] bg-[#0b1728] px-2.5 py-2.5 transition-colors duration-300 motion-reduce:transition-none">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#7f94b2]">Range Selector</p>
            <p className="mt-1 text-sm font-medium text-white">{normalizedRange ? `${normalizedRange.count} candles` : "Not set"}</p>
            <p className="mt-1 line-clamp-2 text-[11px] text-[#8ea5c6]">{rangeSummary}</p>
          </div>
        ) : null}
      </div>
      ) : null}

      <div className={`${isCompact ? "mt-0.5 flex-1 min-h-[260px] sm:min-h-[300px]" : "mt-2"} overflow-hidden rounded-none bg-transparent shadow-none`}>
        <div className={`relative w-full ${isCompact ? "h-full" : "h-[320px] sm:h-[340px]"}`}>
          <div
            ref={containerRef}
            className="h-full w-full"
            data-selected-timestamp={selectedTimestamp || ""}
          />

          {isRangeSelectorMode ? (
            <div
              role="presentation"
              className={`absolute inset-0 z-20 touch-none ${interactionCursorClass}`}
              onPointerDown={handleRangePointerDown}
              onPointerMove={handleRangePointerMove}
              onPointerUp={endRangePointerDrag}
              onPointerCancel={endRangePointerDrag}
              onPointerLeave={() => {
                if (!isDraggingRange) {
                  setHoverMode("idle");
                }
                if (chartRef.current && typeof chartRef.current.clearCrosshairPosition === "function") {
                  chartRef.current.clearCrosshairPosition();
                }
              }}
            />
          ) : null}

          {isRangeSelectorMode && selectionBox ? (
            <div
              className="pointer-events-none absolute bottom-0 top-0 z-30 border-x border-[#6f737c73] bg-[#64676e26]"
              style={{
                left: `${selectionBox.left}px`,
                width: `${selectionBox.width}px`
              }}
            >
              <div className="absolute bottom-0 left-0 top-0 w-[2px] bg-[#7f828ab0]" />
              <div className="absolute bottom-0 right-0 top-0 w-[2px] bg-[#7f828ab0]" />
            </div>
          ) : null}

          {isRangeSelectorMode && selectionBox && normalizedRange ? (
            <>
              <div
                className="pointer-events-none absolute bottom-1 z-40 -translate-x-1/2 rounded-md border border-[#1a6f55] bg-[#0d3a2d]/95 px-2 py-0.5 text-[10px] font-bold text-[#d8fff1] shadow-[0_6px_18px_rgba(9,120,88,0.28)]"
                style={{ left: `${selectionBox.startLabelX ?? selectionBox.startX}px` }}
              >
                {formatAxisTimestamp(Number(normalizedRange.startCandle?.timestamp ?? normalizedRange.startCandle?.time))}
              </div>
              <div
                className="pointer-events-none absolute bottom-1 z-40 -translate-x-1/2 rounded-md border border-[#3e78d8] bg-[#123063]/95 px-2 py-0.5 text-[10px] font-bold text-[#e5f0ff] shadow-[0_6px_18px_rgba(36,88,196,0.3)]"
                style={{ left: `${selectionBox.endLabelX ?? selectionBox.endX}px` }}
              >
                {formatAxisTimestamp(Number(normalizedRange.endCandle?.timestamp ?? normalizedRange.endCandle?.time))}
              </div>
            </>
          ) : null}

          {!isRangeSelectorMode && selectedCandleMarker ? (
            <>
              <div
                className="pointer-events-none absolute bottom-0 top-0 z-30 w-[2px] -translate-x-1/2 bg-[#4ea7ff] shadow-[0_0_14px_rgba(78,167,255,0.35)]"
                style={{ left: `${selectedCandleMarker.x}px` }}
              />
              <div
                className="pointer-events-none absolute bottom-1 z-40 -translate-x-1/2 rounded-md border border-[#4f97ff] bg-[#1d66ff] px-2 py-0.5 text-[10px] font-bold text-white shadow-[0_6px_18px_rgba(29,102,255,0.35)]"
                style={{ left: `${selectedCandleMarker.labelX ?? selectedCandleMarker.x}px` }}
              >
                {selectedCandleMarker.label}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
