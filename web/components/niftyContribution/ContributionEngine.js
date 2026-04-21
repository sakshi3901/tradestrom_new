const TIMEFRAME_CONFIG = {
  "1m": { key: "1m", label: "1m", intervalSeconds: 60, candleCount: 210, amplitude: 0.06, maxMove: 0.6 },
  "3m": { key: "3m", label: "3m", intervalSeconds: 180, candleCount: 180, amplitude: 0.1, maxMove: 1.0 },
  "15m": { key: "15m", label: "15m", intervalSeconds: 900, candleCount: 130, amplitude: 0.22, maxMove: 2.25 },
};

export const NIFTY_TIMEFRAME_OPTIONS = Object.values(TIMEFRAME_CONFIG).map((item) => ({
  value: item.key,
  label: item.label
}));

const BASE_END_UTC_SECONDS = Math.floor(Date.UTC(2026, 1, 24, 10, 0, 0) / 1000); // 15:30 IST
const BASE_INDEX_PREV_CLOSE = 22375;

const NIFTY50_UNIVERSE = [
  { symbol: "ADANIENT", name: "Adani Enterprises", sector: "Industrials" },
  { symbol: "ADANIPORTS", name: "Adani Ports", sector: "Industrials" },
  { symbol: "APOLLOHOSP", name: "Apollo Hospitals", sector: "Healthcare" },
  { symbol: "ASIANPAINT", name: "Asian Paints", sector: "Consumer" },
  { symbol: "AXISBANK", name: "Axis Bank", sector: "Financials" },
  { symbol: "BAJAJ-AUTO", name: "Bajaj Auto", sector: "Auto" },
  { symbol: "BAJAJFINSV", name: "Bajaj Finserv", sector: "Financials" },
  { symbol: "BAJFINANCE", name: "Bajaj Finance", sector: "Financials" },
  { symbol: "BEL", name: "Bharat Electronics", sector: "Industrials" },
  { symbol: "BPCL", name: "BPCL", sector: "Energy" },
  { symbol: "BHARTIARTL", name: "Bharti Airtel", sector: "Telecom" },
  { symbol: "BRITANNIA", name: "Britannia", sector: "FMCG" },
  { symbol: "CIPLA", name: "Cipla", sector: "Healthcare" },
  { symbol: "COALINDIA", name: "Coal India", sector: "Energy" },
  { symbol: "DRREDDY", name: "Dr Reddy's", sector: "Healthcare" },
  { symbol: "EICHERMOT", name: "Eicher Motors", sector: "Auto" },
  { symbol: "GRASIM", name: "Grasim", sector: "Materials" },
  { symbol: "HCLTECH", name: "HCL Tech", sector: "IT" },
  { symbol: "HDFCBANK", name: "HDFC Bank", sector: "Financials" },
  { symbol: "HDFCLIFE", name: "HDFC Life", sector: "Financials" },
  { symbol: "HEROMOTOCO", name: "Hero MotoCorp", sector: "Auto" },
  { symbol: "HINDALCO", name: "Hindalco", sector: "Metals" },
  { symbol: "HINDUNILVR", name: "Hindustan Unilever", sector: "FMCG" },
  { symbol: "ICICIBANK", name: "ICICI Bank", sector: "Financials" },
  { symbol: "INDUSINDBK", name: "IndusInd Bank", sector: "Financials" },
  { symbol: "INFY", name: "Infosys", sector: "IT" },
  { symbol: "ITC", name: "ITC", sector: "FMCG" },
  { symbol: "JSWSTEEL", name: "JSW Steel", sector: "Metals" },
  { symbol: "KOTAKBANK", name: "Kotak Bank", sector: "Financials" },
  { symbol: "LT", name: "Larsen & Toubro", sector: "Industrials" },
  { symbol: "M&M", name: "Mahindra & Mahindra", sector: "Auto" },
  { symbol: "MARUTI", name: "Maruti", sector: "Auto" },
  { symbol: "NESTLEIND", name: "Nestle India", sector: "FMCG" },
  { symbol: "NTPC", name: "NTPC", sector: "Energy" },
  { symbol: "ONGC", name: "ONGC", sector: "Energy" },
  { symbol: "POWERGRID", name: "Power Grid", sector: "Utilities" },
  { symbol: "RELIANCE", name: "Reliance", sector: "Energy" },
  { symbol: "SBILIFE", name: "SBI Life", sector: "Financials" },
  { symbol: "SBIN", name: "SBI", sector: "Financials" },
  { symbol: "SHRIRAMFIN", name: "Shriram Finance", sector: "Financials" },
  { symbol: "SUNPHARMA", name: "Sun Pharma", sector: "Healthcare" },
  { symbol: "TATACONSUM", name: "Tata Consumer", sector: "FMCG" },
  { symbol: "TATAMOTORS", name: "Tata Motors", sector: "Auto" },
  { symbol: "TATASTEEL", name: "Tata Steel", sector: "Metals" },
  { symbol: "TCS", name: "TCS", sector: "IT" },
  { symbol: "TECHM", name: "Tech Mahindra", sector: "IT" },
  { symbol: "TITAN", name: "Titan", sector: "Consumer" },
  { symbol: "TRENT", name: "Trent", sector: "Retail" },
  { symbol: "ULTRACEMCO", name: "UltraTech Cement", sector: "Materials" },
  { symbol: "WIPRO", name: "Wipro", sector: "IT" }
];

const WEIGHT_HINT_OVERRIDES = {
  RELIANCE: 12.7,
  HDFCBANK: 11.3,
  ICICIBANK: 8.1,
  BHARTIARTL: 5.4,
  INFY: 6.1,
  TCS: 4.8,
  ITC: 4.4,
  LT: 4.0,
  SBIN: 3.3,
  AXISBANK: 3.0,
  KOTAKBANK: 2.9,
  BAJFINANCE: 3.1,
  BAJAJFINSV: 2.0,
  HCLTECH: 2.5,
  SUNPHARMA: 2.2,
  MARUTI: 1.9,
  "M&M": 2.1,
  ASIANPAINT: 1.6,
  TITAN: 1.8,
  HINDUNILVR: 2.5,
  NESTLEIND: 1.4,
  NTPC: 1.9,
  ONGC: 1.4,
  POWERGRID: 1.5,
  TATAMOTORS: 1.7,
  TATASTEEL: 1.3,
  JSWSTEEL: 1.1,
  ADANIPORTS: 1.3,
  ADANIENT: 1.0,
  WIPRO: 1.0,
  TECHM: 1.1,
  DRREDDY: 1.1,
  CIPLA: 0.9,
  APOLLOHOSP: 1.0,
  ULTRACEMCO: 1.1,
  GRASIM: 0.9,
  BEL: 0.9,
  TRENT: 1.0
};

const BASE_PRICE_OVERRIDES = {
  RELIANCE: 2850,
  HDFCBANK: 1620,
  ICICIBANK: 1175,
  BHARTIARTL: 1440,
  INFY: 1715,
  TCS: 4075,
  ITC: 470,
  LT: 3650,
  SBIN: 810,
  AXISBANK: 1120,
  KOTAKBANK: 1785,
  BAJFINANCE: 7210,
  BAJAJFINSV: 1760,
  HCLTECH: 1680,
  SUNPHARMA: 1710,
  MARUTI: 12350,
  "M&M": 2250,
  ASIANPAINT: 2920,
  TITAN: 3660,
  HINDUNILVR: 2450,
  NESTLEIND: 24800,
  NTPC: 340,
  ONGC: 295,
  POWERGRID: 308,
  TATAMOTORS: 920,
  TATASTEEL: 158,
  JSWSTEEL: 905,
  ADANIPORTS: 1230,
  ADANIENT: 3130,
  WIPRO: 548,
  TECHM: 1420,
  DRREDDY: 6380,
  CIPLA: 1530,
  APOLLOHOSP: 6460,
  ULTRACEMCO: 11850,
  GRASIM: 2410,
  BEL: 302,
  TRENT: 5360,
  HDFCLIFE: 675,
  SBILIFE: 1510,
  SHRIRAMFIN: 2780
};

const SECTOR_PRICE_RANGES = {
  Auto: [650, 9800],
  Consumer: [1800, 5200],
  Energy: [180, 3200],
  FMCG: [380, 24000],
  Financials: [450, 2200],
  Healthcare: [850, 7000],
  Industrials: [220, 4200],
  IT: [300, 4300],
  Materials: [650, 12500],
  Metals: [120, 1200],
  Retail: [900, 6500],
  Telecom: [650, 1650],
  Utilities: [200, 420]
};

const SECTOR_VOLATILITY = {
  Auto: 1.15,
  Consumer: 0.88,
  Energy: 1.25,
  FMCG: 0.82,
  Financials: 1.02,
  Healthcare: 0.94,
  Industrials: 1.08,
  IT: 0.97,
  Materials: 1.05,
  Metals: 1.35,
  Retail: 1.18,
  Telecom: 0.9,
  Utilities: 0.78
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function hashString(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed) {
  let value = seed >>> 0;
  return function rng() {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function binarySearchLE(sortedArray, target) {
  let low = 0;
  let high = sortedArray.length - 1;
  let answer = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (sortedArray[mid] <= target) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return answer;
}

function binarySearchNearest(sortedArray, target) {
  if (!sortedArray.length) {
    return -1;
  }

  let low = 0;
  let high = sortedArray.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const value = sortedArray[mid];
    if (value === target) {
      return mid;
    }
    if (value < target) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (high < 0) {
    return 0;
  }
  if (low >= sortedArray.length) {
    return sortedArray.length - 1;
  }

  const before = sortedArray[high];
  const after = sortedArray[low];
  return Math.abs(target - before) <= Math.abs(after - target) ? high : low;
}

function getWeightHint(symbol, sector) {
  const override = WEIGHT_HINT_OVERRIDES[symbol];
  if (typeof override === "number") {
    return override;
  }

  const sectorBase = {
    Financials: 1.25,
    IT: 1.05,
    Energy: 1.05,
    FMCG: 0.95,
    Auto: 0.9,
    Industrials: 0.85,
    Healthcare: 0.8,
    Consumer: 0.75,
    Materials: 0.7,
    Metals: 0.65,
    Telecom: 0.8,
    Utilities: 0.6,
    Retail: 0.55
  }[sector] || 0.7;

  const noise = (hashString(`${symbol}|weight`) % 700) / 1000;
  return round(sectorBase + noise, 4);
}

function getBasePrice(symbol, sector) {
  if (typeof BASE_PRICE_OVERRIDES[symbol] === "number") {
    return BASE_PRICE_OVERRIDES[symbol];
  }

  const [minPrice, maxPrice] = SECTOR_PRICE_RANGES[sector] || [200, 3000];
  const seed = hashString(`${symbol}|price`);
  const ratio = ((seed % 10000) / 10000);
  const curvedRatio = 0.18 + (ratio ** 1.65) * 0.82;
  return round(minPrice + (maxPrice - minPrice) * curvedRatio, 2);
}

function buildUniverse() {
  const hydrated = NIFTY50_UNIVERSE.map((stock) => {
    const seed = hashString(stock.symbol);
    const volatilityMultiplier = SECTOR_VOLATILITY[stock.sector] || 1;
    const beta = 0.72 + ((seed % 600) / 1000);
    const alpha = (((seed >> 8) % 400) - 200) / 10000;
    const weightHint = getWeightHint(stock.symbol, stock.sector);
    const basePrice = getBasePrice(stock.symbol, stock.sector);

    return {
      ...stock,
      basePrice,
      weightHint,
      beta: round(beta, 4),
      alpha: round(alpha, 4),
      volatilityMultiplier
    };
  });

  const totalWeightHint = hydrated.reduce((sum, stock) => sum + stock.weightHint, 0) || 1;

  return hydrated.map((stock) => ({
    ...stock,
    weight: stock.weightHint / totalWeightHint,
    weightPct: (stock.weightHint / totalWeightHint) * 100
  }));
}

function buildIndexTimestamps(config) {
  const end = BASE_END_UTC_SECONDS;
  const start = end - (config.candleCount - 1) * config.intervalSeconds;
  const timestamps = [];
  for (let index = 0; index < config.candleCount; index += 1) {
    timestamps.push(start + index * config.intervalSeconds);
  }
  return timestamps;
}

function generateFullStockCandles(stock, config, timestamps) {
  const seed = hashString(`${stock.symbol}|${config.key}|full`);
  const rng = createRng(seed);
  const phase = (seed % 360) * (Math.PI / 180);
  const phase2 = ((seed >> 8) % 360) * (Math.PI / 180);
  const phase3 = ((seed >> 16) % 360) * (Math.PI / 180);

  const sectorSeed = hashString(`${stock.sector}|${config.key}`);
  const sectorPhase = (sectorSeed % 360) * (Math.PI / 180);
  const sectorPhase2 = ((sectorSeed >> 9) % 360) * (Math.PI / 180);

  const amplitude = config.amplitude * stock.volatilityMultiplier;
  const maxMove = config.maxMove * Math.min(1.45, stock.volatilityMultiplier + 0.15);

  let previousClose = stock.basePrice * (1 + (((seed >> 20) % 200) - 100) / 6000);
  let momentum = (((seed >> 12) % 200) - 100) / 5000;

  const candles = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index];

    const marketWave = Math.sin(index / 12 + phase) * config.amplitude * 0.55 + Math.sin(index / 37 + phase2) * config.amplitude * 0.35;
    const sectorWave = Math.sin(index / 16 + sectorPhase) * config.amplitude * 0.3 + Math.sin(index / 49 + sectorPhase2) * config.amplitude * 0.15;
    const symbolWave = Math.sin(index / 9 + phase3) * amplitude * 0.18;
    const noise = (rng() - 0.5) * amplitude * 1.2;

    let shock = 0;
    if (((index + (seed % 23)) % (41 + (seed % 9))) === 0 && index > 2) {
      shock = (rng() - 0.5) * amplitude * 2.2;
    }

    const changePct = clamp(
      momentum * 0.42 + marketWave * stock.beta + sectorWave + symbolWave + stock.alpha + noise + shock,
      -maxMove,
      maxMove
    );

    const open = previousClose;
    const close = Math.max(1, open * (1 + changePct / 100));
    const upperWickPct = Math.abs(changePct) * (0.25 + rng() * 0.45) + rng() * amplitude * 0.55;
    const lowerWickPct = Math.abs(changePct) * (0.22 + rng() * 0.45) + rng() * amplitude * 0.5;
    const high = Math.max(open, close) * (1 + upperWickPct / 100);
    const low = Math.max(1, Math.min(open, close) * (1 - lowerWickPct / 100));

    candles.push({
      timestamp,
      time: timestamp,
      open: round(open, 2),
      high: round(high, 2),
      low: round(low, 2),
      close: round(close, 2),
      volume: Math.round(25000 + rng() * 250000)
    });

    previousClose = close;
    momentum = changePct;
  }

  return {
    initialPrevClose: round(stock.basePrice * (1 + (((seed >> 20) % 200) - 100) / 6000), 2),
    fullCandles: candles
  };
}

function buildVisibleStockCandles(stock, config, fullCandles) {
  const gapSeed = hashString(`${stock.symbol}|${config.key}|gap`);
  const isGapProne = stock.weight < 0.015 || (gapSeed % 7 === 0);
  const gapStep = 17 + (gapSeed % 19);
  const gapOffset = (gapSeed >> 4) % gapStep;

  const visibleCandles = [];
  for (let index = 0; index < fullCandles.length; index += 1) {
    const candle = fullCandles[index];
    let drop = false;

    if (isGapProne && index > 1 && index < fullCandles.length - 1) {
      const patternA = ((index + gapOffset) % gapStep) === 0;
      const patternB = config.key !== "1m" && ((index + gapOffset * 2 + 3) % (gapStep + 7)) === 0;
      drop = patternA || patternB;
    }

    if (!drop) {
      visibleCandles.push(candle);
    }
  }

  if (!visibleCandles.length && fullCandles.length) {
    visibleCandles.push(fullCandles[0]);
  }

  return visibleCandles;
}

function buildSeriesIndex(candles, initialPrevClose) {
  const timestamps = candles.map((candle) => candle.timestamp);
  const byTimestamp = new Map(candles.map((candle) => [candle.timestamp, candle]));
  return {
    candles,
    timestamps,
    byTimestamp,
    initialPrevClose: round(initialPrevClose, 2)
  };
}

function getAlignedClose(seriesIndex, targetTimestamp) {
  if (!seriesIndex || !Number.isFinite(targetTimestamp)) {
    return {
      close: 0,
      exact: false,
      sourceTimestamp: null,
      candle: null
    };
  }

  const exactCandle = seriesIndex.byTimestamp.get(targetTimestamp);
  if (exactCandle) {
    return {
      close: exactCandle.close,
      exact: true,
      sourceTimestamp: exactCandle.timestamp,
      candle: exactCandle
    };
  }

  const candidateIndex = binarySearchLE(seriesIndex.timestamps, targetTimestamp);
  if (candidateIndex >= 0) {
    const candle = seriesIndex.candles[candidateIndex];
    return {
      close: candle.close,
      exact: false,
      sourceTimestamp: candle.timestamp,
      candle
    };
  }

  return {
    close: seriesIndex.initialPrevClose,
    exact: false,
    sourceTimestamp: null,
    candle: null
  };
}

function buildIndexCandlesFromStocks(config, timestamps, stocks, stockSeriesIndexes) {
  const indexCandles = [];
  let previousIndexClose = BASE_INDEX_PREV_CLOSE;

  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index];
    const previousTimestamp = index > 0 ? timestamps[index - 1] : null;

    let aggregatePct = 0;
    let dispersion = 0;

    for (const stock of stocks) {
      const seriesIndex = stockSeriesIndexes[stock.symbol];
      const current = getAlignedClose(seriesIndex, timestamp);
      const previous = previousTimestamp === null
        ? { close: seriesIndex.initialPrevClose }
        : getAlignedClose(seriesIndex, previousTimestamp);

      const currentClose = Number(current.close) || 0;
      const previousClose = Number(previous.close) || 0;
      const stockPct = previousClose > 0 ? ((currentClose - previousClose) / previousClose) * 100 : 0;

      aggregatePct += stock.weight * stockPct;
      dispersion += Math.abs(stockPct) * stock.weight;
    }

    const open = previousIndexClose;
    const close = Math.max(1, open * (1 + aggregatePct / 100));
    const wigglePct = clamp(dispersion * 0.45, 0.04, config.maxMove * 0.5);
    const high = Math.max(open, close) * (1 + wigglePct / 100);
    const low = Math.max(1, Math.min(open, close) * (1 - wigglePct * 0.92 / 100));

    indexCandles.push({
      timestamp,
      time: timestamp,
      open: round(open, 2),
      high: round(high, 2),
      low: round(low, 2),
      close: round(close, 2),
      volume: Math.round(1_500_000 + dispersion * 150_000)
    });

    previousIndexClose = close;
  }

  return {
    indexCandles,
    indexBasePrevClose: BASE_INDEX_PREV_CLOSE
  };
}

function buildTimeframeDataset(config, sharedUniverse) {
  const timestamps = buildIndexTimestamps(config);
  const stockSeriesBySymbol = {};
  const stockSeriesIndexes = {};
  const stockMetadata = [];

  for (const stock of sharedUniverse) {
    const { initialPrevClose, fullCandles } = generateFullStockCandles(stock, config, timestamps);
    const visibleCandles = buildVisibleStockCandles(stock, config, fullCandles);
    const seriesIndex = buildSeriesIndex(visibleCandles, initialPrevClose);

    stockSeriesBySymbol[stock.symbol] = visibleCandles;
    stockSeriesIndexes[stock.symbol] = seriesIndex;

    stockMetadata.push({
      symbol: stock.symbol,
      name: stock.name,
      sector: stock.sector,
      weight: (Number(stock.weightRawPct ?? stock.weightPct) || ((Number(stock.weight) || 0) * 100)) / 100,
      weightPct: Number(stock.weightRawPct ?? stock.weightPct) || ((Number(stock.weight) || 0) * 100),
      basePrice: stock.basePrice,
      beta: stock.beta,
      alpha: stock.alpha,
      initialPrevClose: seriesIndex.initialPrevClose,
      missingCandleCount: Math.max(0, timestamps.length - visibleCandles.length)
    });
  }

  const { indexCandles, indexBasePrevClose } = buildIndexCandlesFromStocks(
    config,
    timestamps,
    stockMetadata,
    stockSeriesIndexes
  );

  const indexTimestamps = indexCandles.map((candle) => candle.timestamp);
  const indexByTimestamp = new Map(indexCandles.map((candle) => [candle.timestamp, candle]));
  const sectors = Array.from(new Set(stockMetadata.map((stock) => stock.sector))).sort((a, b) => a.localeCompare(b));

  return {
    timeframe: config.key,
    label: config.label,
    intervalSeconds: config.intervalSeconds,
    timestamps,
    stocks: stockMetadata,
    sectors,
    indexCandles,
    indexTimestamps,
    indexByTimestamp,
    indexBasePrevClose,
    stockSeriesBySymbol,
    stockSeriesIndexes,
    weightSum: stockMetadata.reduce((sum, stock) => sum + stock.weight, 0)
  };
}

let DATASET_CACHE = null;

function ensureDatasets() {
  if (DATASET_CACHE) {
    return DATASET_CACHE;
  }

  const universe = buildUniverse();
  DATASET_CACHE = Object.values(TIMEFRAME_CONFIG).reduce((accumulator, config) => {
    accumulator[config.key] = buildTimeframeDataset(config, universe);
    return accumulator;
  }, {});

  return DATASET_CACHE;
}

export function getNiftyContributionTimeframeDataset(timeframe = "1m") {
  const datasets = ensureDatasets();
  return datasets[timeframe] || datasets["1m"];
}

export function getNearestIndexTimestamp(dataset, targetTimestamp) {
  if (!dataset?.indexTimestamps?.length) {
    return null;
  }
  if (!Number.isFinite(targetTimestamp)) {
    return dataset.indexTimestamps[dataset.indexTimestamps.length - 1];
  }
  const index = binarySearchNearest(dataset.indexTimestamps, targetTimestamp);
  return index >= 0 ? dataset.indexTimestamps[index] : dataset.indexTimestamps[dataset.indexTimestamps.length - 1];
}

export function getDefaultSelectedTimestamp(dataset) {
  if (!dataset?.indexTimestamps?.length) {
    return null;
  }
  return dataset.indexTimestamps[0];
}

export function computeContributionSnapshot(dataset, selectedTimestamp) {
  if (!dataset?.indexCandles?.length) {
    return {
      rows: [],
      selectedCandle: null,
      validation: null,
      meta: null
    };
  }

  const resolvedTimestamp = getNearestIndexTimestamp(dataset, selectedTimestamp);
  const selectedIndex = dataset.indexTimestamps.indexOf(resolvedTimestamp);
  const selectedCandle = dataset.indexByTimestamp.get(resolvedTimestamp);
  if (!selectedCandle) {
    return {
      rows: [],
      selectedCandle: null,
      validation: null,
      meta: null
    };
  }

  const previousIndexCandle = selectedIndex > 0 ? dataset.indexCandles[selectedIndex - 1] : null;
  const referenceIndexClose = previousIndexCandle?.close || selectedCandle.open || dataset.indexBasePrevClose;
  const referenceTimestamp = previousIndexCandle?.timestamp ?? null;
  const indexPointChange = selectedCandle.close - referenceIndexClose;
  const indexPercentChange = referenceIndexClose > 0 ? (indexPointChange / referenceIndexClose) * 100 : 0;

  let sumPointContributions = 0;
  let sumPercentContributions = 0;
  let missingCurrentCount = 0;
  let missingPrevCount = 0;

  const rows = dataset.stocks.map((stock) => {
    const seriesIndex = dataset.stockSeriesIndexes[stock.symbol];
    const current = getAlignedClose(seriesIndex, selectedCandle.timestamp);
    const previous = referenceTimestamp === null
      ? {
          close: seriesIndex.initialPrevClose,
          exact: true,
          sourceTimestamp: null,
          candle: null
        }
      : getAlignedClose(seriesIndex, referenceTimestamp);

    const currentClose = Number(current.close) || 0;
    const previousClose = Number(previous.close) || 0;
    const sessionBaseClose = Number(seriesIndex.initialPrevClose) || previousClose;
    const perChange = sessionBaseClose > 0 ? ((currentClose - sessionBaseClose) / sessionBaseClose) * 100 : 0;
    const weightPercent = Number(stock.weightPct) || ((Number(stock.weight) || 0) * 100);
    const perToIndex = perChange * (weightPercent / 100);
    const pointBase = Number(dataset.indexBasePrevClose) || referenceIndexClose || 0;
    const pointToIndex = pointBase > 0 ? (perToIndex / 100) * pointBase : 0;

    if (!current.exact) {
      missingCurrentCount += 1;
    }
    if (referenceTimestamp !== null && !previous.exact) {
      missingPrevCount += 1;
    }

    sumPointContributions += pointToIndex;
    sumPercentContributions += perToIndex;

    return {
      symbol: stock.symbol,
      name: stock.name,
      sector: stock.sector,
      weight: stock.weight,
      weightPct: stock.weightPct,
      close: round(currentClose, 2),
      prevClose: round(previousClose, 2),
      perChange: round(perChange, 4),
      perToIndex: round(perToIndex, 6),
      pointToIndex: round(pointToIndex, 4),
      exactCurrentCandle: current.exact,
      exactPrevCandle: referenceTimestamp === null ? true : previous.exact,
      currentSourceTimestamp: current.sourceTimestamp,
      prevSourceTimestamp: previous.sourceTimestamp,
      stale: !current.exact || (referenceTimestamp !== null && !previous.exact)
    };
  });

  rows.sort((a, b) => {
    const absDiff = Math.abs(b.pointToIndex) - Math.abs(a.pointToIndex);
    if (absDiff !== 0) {
      return absDiff;
    }
    return a.symbol.localeCompare(b.symbol);
  });

  const errorDifference = sumPointContributions - indexPointChange;

  return {
    rows,
    selectedCandle: {
      ...selectedCandle,
      previousClose: round(referenceIndexClose, 2),
      previousTimestamp: referenceTimestamp,
      pointChange: round(indexPointChange, 2),
      percentChange: round(indexPercentChange, 4),
      candleNumber: selectedIndex + 1,
      totalCandles: dataset.indexCandles.length
    },
    validation: {
      sumPointContributions: round(sumPointContributions, 4),
      actualIndexCandleChange: round(indexPointChange, 4),
      errorDifference: round(errorDifference, 4),
      sumPercentContributions: round(sumPercentContributions, 6),
      actualIndexPercentChange: round(indexPercentChange, 6),
      missingCurrentCount,
      missingPrevCount,
      weightSum: round(dataset.weightSum, 8),
      stockCount: dataset.stocks.length
    },
    meta: {
      resolvedTimestamp,
      selectedIndex,
      intervalSeconds: dataset.intervalSeconds,
      sectors: dataset.sectors
    }
  };
}

export function getLocalNiftyConstituentMetadata() {
  return NIFTY50_UNIVERSE.map((row) => ({
    symbol: row.symbol,
    name: row.name,
    sector: row.sector
  }));
}

function buildLocalMetaLookup() {
  return new Map(
    NIFTY50_UNIVERSE.map((row) => [
      row.symbol,
      {
        name: row.name,
        sector: row.sector
      }
    ])
  );
}

function asFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeCandleLike(input) {
  const timestamp = asFiniteNumber(input?.timestamp ?? input?.time, NaN);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }
  return {
    timestamp,
    time: timestamp,
    open: round(asFiniteNumber(input?.open, 0), 2),
    high: round(asFiniteNumber(input?.high, 0), 2),
    low: round(asFiniteNumber(input?.low, 0), 2),
    close: round(asFiniteNumber(input?.close, 0), 2),
    volume: Math.round(asFiniteNumber(input?.volume, 0))
  };
}

export function adaptLiveContributionSeriesPayload(payload) {
  const localMeta = buildLocalMetaLookup();

  const rawIndexCandles = Array.isArray(payload?.index_candles) ? payload.index_candles : [];
  const indexCandles = rawIndexCandles
    .map((row) => normalizeCandleLike(row))
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);

  const indexTimestamps = indexCandles.map((candle) => candle.timestamp);
  const indexByTimestamp = new Map(indexCandles.map((candle) => [candle.timestamp, candle]));

  const rawConstituents = Array.isArray(payload?.constituents) ? payload.constituents : [];
  const weightSumRaw = rawConstituents.reduce((sum, row) => sum + Math.max(0, asFiniteNumber(row?.weight, 0)), 0);
  const safeWeightSumRaw = weightSumRaw > 0 ? weightSumRaw : 1;

  const stocks = rawConstituents
    .map((row) => {
      const symbol = String(row?.symbol || "").trim().toUpperCase();
      if (!symbol) {
        return null;
      }
      const local = localMeta.get(symbol);
      const weightRaw = Math.max(0, asFiniteNumber(row?.weight, 0));
      const normalizedWeight = weightRaw / safeWeightSumRaw;
      return {
        symbol,
        name: String(row?.name || local?.name || symbol),
        sector: String(local?.sector || "Other"),
        ltp: round(asFiniteNumber(row?.ltp, 0), 2),
        previousDayClose: round(asFiniteNumber(row?.previous_day_close, 0), 2),
        weightRawPct: round(weightRaw, 6),
        weight: normalizedWeight,
        weightPct: normalizedWeight * 100
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  const snapshotsByTimestamp = {};
  const rawSnapshots = payload?.snapshots && typeof payload.snapshots === "object" ? payload.snapshots : {};
  for (const [timestampKey, snapshotRows] of Object.entries(rawSnapshots)) {
    const timestamp = asFiniteNumber(timestampKey, NaN);
    if (!Number.isFinite(timestamp)) {
      continue;
    }
    const normalizedSnapshot = {};
    if (snapshotRows && typeof snapshotRows === "object") {
      for (const [rawSymbol, rawRow] of Object.entries(snapshotRows)) {
        const symbol = String(rawSymbol || "").trim().toUpperCase();
        if (!symbol) {
          continue;
        }
        normalizedSnapshot[symbol] = {
          per_change: asFiniteNumber(rawRow?.per_change, 0),
          per_to_index: asFiniteNumber(rawRow?.per_to_index, 0),
          point_to_index: asFiniteNumber(rawRow?.point_to_index, 0),
          close: asFiniteNumber(rawRow?.close, 0),
          session_prev_close: asFiniteNumber(rawRow?.session_prev_close, 0),
          weight: asFiniteNumber(rawRow?.weight, 0),
          source_timestamp: asFiniteNumber(rawRow?.source_timestamp, 0) || null,
          exact: rawRow?.exact !== false
        };
      }
    }
    snapshotsByTimestamp[timestamp] = normalizedSnapshot;
  }

  const sectors = Array.from(new Set(stocks.map((stock) => stock.sector))).sort((a, b) => a.localeCompare(b));

  return {
    kind: "live",
    timeframe: String(payload?.interval || "1m"),
    label: String(payload?.interval || "1m"),
    source: String(payload?.source || "unknown"),
    generatedAt: asFiniteNumber(payload?.generated_at, 0),
    sessionStartTimestamp: asFiniteNumber(payload?.session_start_timestamp, 0),
    sessionEndTimestamp: asFiniteNumber(payload?.session_end_timestamp, 0),
    indexCandles,
    indexTimestamps,
    indexByTimestamp,
    snapshotsByTimestamp,
    stocks,
    sectors,
    weightSum: stocks.reduce((sum, stock) => sum + stock.weight, 0)
  };
}

export function computeContributionSnapshotFromLiveDataset(dataset, selectedTimestamp) {
  if (!dataset?.indexCandles?.length) {
    return {
      rows: [],
      selectedCandle: null,
      validation: null,
      meta: null
    };
  }

  const resolvedTimestamp = getNearestIndexTimestamp(dataset, selectedTimestamp);
  const selectedIndex = dataset.indexTimestamps.indexOf(resolvedTimestamp);
  const selectedCandle = dataset.indexByTimestamp.get(resolvedTimestamp);
  if (!selectedCandle) {
    return {
      rows: [],
      selectedCandle: null,
      validation: null,
      meta: null
    };
  }

  const previousIndexCandle = selectedIndex > 0 ? dataset.indexCandles[selectedIndex - 1] : null;
  const referenceIndexClose = previousIndexCandle?.close || selectedCandle.open || 0;
  const referenceTimestamp = previousIndexCandle?.timestamp ?? null;

  const currentSnapshot = dataset.snapshotsByTimestamp?.[resolvedTimestamp] || {};
  const previousSnapshot = referenceTimestamp ? (dataset.snapshotsByTimestamp?.[referenceTimestamp] || {}) : {};

  const indexPointChange = round(selectedCandle.close - referenceIndexClose, 4);
  const indexPercentChange = referenceIndexClose > 0 ? round(((selectedCandle.close - referenceIndexClose) / referenceIndexClose) * 100, 6) : 0;

  let sumPointContributions = 0;
  let sumPercentContributions = 0;
  let missingCurrentCount = 0;
  let missingPrevCount = 0;

  const rows = (Array.isArray(dataset.stocks) ? dataset.stocks : []).map((stock) => {
    const current = currentSnapshot[stock.symbol] || null;
    const previous = referenceTimestamp ? (previousSnapshot[stock.symbol] || null) : null;

    const snapshotClose = asFiniteNumber(
      current?.close,
      asFiniteNumber(previous?.close, asFiniteNumber(current?.session_prev_close, asFiniteNumber(previous?.session_prev_close, 0)))
    );
    const previousSnapshotClose = referenceTimestamp
      ? asFiniteNumber(previous?.close, asFiniteNumber(current?.session_prev_close, snapshotClose))
      : asFiniteNumber(current?.session_prev_close, snapshotClose);
    const currentClose = snapshotClose;
    const previousClose = asFiniteNumber(
      current?.session_prev_close,
      asFiniteNumber(previous?.session_prev_close, previousSnapshotClose)
    );

    const sessionBaseClose = asFiniteNumber(
      current?.session_prev_close,
      asFiniteNumber(previous?.session_prev_close, previousSnapshotClose)
    );
    const fallbackPerChange = sessionBaseClose > 0 ? ((snapshotClose - sessionBaseClose) / sessionBaseClose) * 100 : 0;
    const officialWeightPercent = Number(stock.weightRawPct ?? stock.weightPct ?? current?.weight ?? previous?.weight) || ((Number(stock.weight) || 0) * 100);
    const fallbackPerToIndex = fallbackPerChange * (officialWeightPercent / 100);
    const fallbackPointBase = Number(dataset.indexBasePrevClose) || Number(selectedCandle?.previousClose) || referenceIndexClose || 0;
    const fallbackPointToIndex = fallbackPointBase > 0 ? (fallbackPerToIndex / 100) * fallbackPointBase : 0;

    const perChange = Number.isFinite(current?.per_change) ? current.per_change : fallbackPerChange;
    const perToIndex = Number.isFinite(current?.per_to_index) ? current.per_to_index : fallbackPerToIndex;
    const pointToIndex = Number.isFinite(current?.point_to_index) ? current.point_to_index : fallbackPointToIndex;
    const displayWeightPercent = officialWeightPercent;

    const currentSourceTimestamp = current?.source_timestamp || null;
    const prevSourceTimestamp = previous?.source_timestamp || null;
    const exactCurrentCandle = Boolean(current) && current.exact !== false && currentSourceTimestamp === resolvedTimestamp;
    const exactPrevCandle = referenceTimestamp === null
      ? true
      : (Boolean(previous) && previous.exact !== false && prevSourceTimestamp === referenceTimestamp);

    if (!exactCurrentCandle) {
      missingCurrentCount += 1;
    }
    if (referenceTimestamp !== null && !exactPrevCandle) {
      missingPrevCount += 1;
    }

    sumPointContributions += pointToIndex;
    sumPercentContributions += perToIndex;

    return {
      symbol: stock.symbol,
      name: stock.name,
      sector: stock.sector,
      weight: displayWeightPercent / 100,
      weightPct: displayWeightPercent,
      close: round(currentClose, 2),
      prevClose: round(previousClose, 2),
      perChange: round(perChange, 4),
      perToIndex: round(perToIndex, 6),
      pointToIndex: round(pointToIndex, 4),
      exactCurrentCandle,
      exactPrevCandle,
      currentSourceTimestamp,
      prevSourceTimestamp,
      stale: !exactCurrentCandle || (referenceTimestamp !== null && !exactPrevCandle)
    };
  });

  rows.sort((a, b) => {
    const absDiff = Math.abs(b.pointToIndex) - Math.abs(a.pointToIndex);
    if (absDiff !== 0) {
      return absDiff;
    }
    return a.symbol.localeCompare(b.symbol);
  });

  return {
    rows,
    selectedCandle: {
      ...selectedCandle,
      previousClose: round(referenceIndexClose, 2),
      previousTimestamp: referenceTimestamp,
      pointChange: round(indexPointChange, 2),
      percentChange: round(indexPercentChange, 4),
      candleNumber: selectedIndex + 1,
      totalCandles: dataset.indexCandles.length
    },
    validation: {
      sumPointContributions: round(sumPointContributions, 4),
      actualIndexCandleChange: round(indexPointChange, 4),
      errorDifference: round(sumPointContributions - indexPointChange, 4),
      sumPercentContributions: round(sumPercentContributions, 6),
      actualIndexPercentChange: round(indexPercentChange, 6),
      missingCurrentCount,
      missingPrevCount,
      weightSum: round(dataset.weightSum, 8),
      stockCount: rows.length
    },
    meta: {
      resolvedTimestamp,
      selectedIndex,
      intervalSeconds: null,
      sectors: dataset.sectors
    }
  };
}
