const CHAIN_DEPTH = 10;
const EXPECTED_STRIKE_COUNT = (CHAIN_DEPTH * 2) + 1;
const EXPECTED_LEG_COUNT = EXPECTED_STRIKE_COUNT * 2;

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

function getPreviousTradingDayTimestampCandidates(requestTimestamp, maxDays = 7) {
  const requestTs = normalizeTimestamp(requestTimestamp);
  if (!requestTs) {
    return [];
  }

  const requestIstDate = getISTDateFromUnix(requestTs);
  const requestMinuteOfDay = (requestIstDate.getHours() * 60) + requestIstDate.getMinutes();
  const sessionOpenMinute = (9 * 60) + 15;
  const sessionLastClosedMinute = (15 * 60) + 29;
  const normalizedRequestMinute = requestMinuteOfDay < sessionOpenMinute
    ? sessionLastClosedMinute
    : Math.min(requestMinuteOfDay, sessionLastClosedMinute);

  const out = [];
  const seen = new Set();
  const cursor = new Date(Date.UTC(
    requestIstDate.getFullYear(),
    requestIstDate.getMonth(),
    requestIstDate.getDate(),
    0,
    0,
    0,
    0
  ));

  while (out.length < Math.max(1, maxDays)) {
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

    const sameMinuteTs = normalizeTimestamp(minuteToUnixForISTDate(parts, normalizedRequestMinute));
    if (sameMinuteTs && !seen.has(sameMinuteTs)) {
      seen.add(sameMinuteTs);
      out.push(sameMinuteTs);
    }

    const closeMinuteTs = normalizeTimestamp(minuteToUnixForISTDate(parts, sessionLastClosedMinute));
    if (closeMinuteTs && !seen.has(closeMinuteTs)) {
      seen.add(closeMinuteTs);
      out.push(closeMinuteTs);
    }
  }

  return out;
}

function isWeekendIST(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function getPreviousTradingDayIST(date) {
  const cursor = new Date(date);
  do {
    cursor.setDate(cursor.getDate() - 1);
  } while (isWeekendIST(cursor));
  return cursor;
}

function getISTUnixForMinute(date, minuteOfDay) {
  const minute = Math.max(0, Math.min(1439, Math.floor(Number(minuteOfDay) || 0)));
  const parts = {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate()
  };
  return minuteToUnixForISTDate(parts, minute);
}

function getClosedMinuteCutoffIST() {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const totalMinutes = (istNow.getHours() * 60) + istNow.getMinutes();
  const sessionOpenMinute = (9 * 60) + 15;
  const sessionSwitchMinute = (9 * 60) + 10;
  const sessionLastClosedMinute = (15 * 60) + 29;

  if (isWeekendIST(istNow) || totalMinutes < sessionSwitchMinute) {
    const previousTradingDay = getPreviousTradingDayIST(istNow);
    return normalizeTimestamp(getISTUnixForMinute(previousTradingDay, sessionLastClosedMinute));
  }

  if (totalMinutes > sessionLastClosedMinute) {
    return normalizeTimestamp(getISTUnixForMinute(istNow, sessionLastClosedMinute));
  }

  const currentMinute = Math.floor(istNow.getTime() / 1000 / 60) * 60;
  const closedMinute = currentMinute - 60;
  const sessionOpenUnix = normalizeTimestamp(getISTUnixForMinute(istNow, sessionOpenMinute));
  if (closedMinute < sessionOpenUnix) {
    const previousTradingDay = getPreviousTradingDayIST(istNow);
    return normalizeTimestamp(getISTUnixForMinute(previousTradingDay, sessionLastClosedMinute));
  }

  return normalizeTimestamp(closedMinute);
}

function clampToClosedMinute(value) {
  const ts = normalizeTimestamp(value);
  if (!ts) {
    return null;
  }
  const cutoff = getClosedMinuteCutoffIST();
  if (Number.isFinite(cutoff) && ts > cutoff) {
    return cutoff;
  }
  return ts;
}

function strikeKey(value) {
  return String(round(asFiniteNumber(value, 0), 2));
}

function parseStrikeFromOptionSymbol(symbol) {
  const normalized = String(symbol || "").toUpperCase().trim();
  if (!normalized) {
    return null;
  }
  const match = normalized.match(/(\d+)(CE|PE)$/);
  if (!match) {
    return null;
  }
  const strike = Number(match[1]);
  if (!Number.isFinite(strike) || strike <= 0) {
    return null;
  }
  return {
    strike,
    type: match[2]
  };
}

function buildLegSymbolLookup(snapshot) {
  const out = new Map();
  const data = snapshot && typeof snapshot === "object" && snapshot.data && typeof snapshot.data === "object"
    ? snapshot.data
    : {};

  for (const rawKey of Object.keys(data)) {
    const parsed = parseStrikeFromOptionSymbol(rawKey);
    if (!parsed) {
      continue;
    }
    const key = `${strikeKey(parsed.strike)}:${parsed.type}`;
    out.set(key, String(rawKey));
  }

  return out;
}

function sortSnapshotStrikes(snapshot) {
  const strikeStateMap = new Map();

  const ensureStrikeState = (strikeValue) => {
    const numericStrike = asFiniteNumber(strikeValue, NaN);
    if (!Number.isFinite(numericStrike) || numericStrike <= 0) {
      return null;
    }
    const key = strikeKey(numericStrike);
    const existing = strikeStateMap.get(key);
    if (existing) {
      return existing;
    }
    const created = {
      strike: numericStrike,
      call: {},
      put: {}
    };
    strikeStateMap.set(key, created);
    return created;
  };

  const strikes = Array.isArray(snapshot?.strikes) ? snapshot.strikes : [];
  for (const strike of strikes) {
    const state = ensureStrikeState(strike?.strike);
    if (!state) {
      continue;
    }
    state.call = {
      oi: asFiniteNumber(strike?.call?.oi, 0),
      volume: asFiniteNumber(strike?.call?.volume, 0),
      iv: asFiniteNumber(strike?.call?.iv, 0),
      ltp: asFiniteNumber(strike?.call?.ltp, 0)
    };
    state.put = {
      oi: asFiniteNumber(strike?.put?.oi, 0),
      volume: asFiniteNumber(strike?.put?.volume, 0),
      iv: asFiniteNumber(strike?.put?.iv, 0),
      ltp: asFiniteNumber(strike?.put?.ltp, 0)
    };
  }

  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  for (const row of rows) {
    const state = ensureStrikeState(row?.strike);
    if (!state) {
      continue;
    }
    const type = String(row?.type || "").toUpperCase().trim();
    const target = type === "PE" ? state.put : state.call;
    target.oi = asFiniteNumber(row?.oi, target.oi || 0);
    target.volume = asFiniteNumber(row?.volume, target.volume || 0);
    target.iv = asFiniteNumber(row?.iv, target.iv || 0);
    target.ltp = asFiniteNumber(row?.ltp, target.ltp || 0);
  }

  const data = snapshot && typeof snapshot === "object" && snapshot.data && typeof snapshot.data === "object"
    ? snapshot.data
    : {};
  for (const [symbol, oiValue] of Object.entries(data)) {
    const parsed = parseStrikeFromOptionSymbol(symbol);
    if (!parsed) {
      continue;
    }
    const state = ensureStrikeState(parsed.strike);
    if (!state) {
      continue;
    }
    const target = parsed.type === "PE" ? state.put : state.call;
    if (!Number.isFinite(asFiniteNumber(target.oi, NaN)) || asFiniteNumber(target.oi, 0) <= 0) {
      target.oi = asFiniteNumber(oiValue, 0);
    }
  }

  return [...strikeStateMap.values()]
    .filter((strike) => Number.isFinite(strike.strike) && strike.strike > 0)
    .sort((a, b) => a.strike - b.strike);
}

function findAtmIndex(strikes, underlying) {
  if (!Array.isArray(strikes) || strikes.length === 0) {
    return -1;
  }
  const reference = asFiniteNumber(underlying, 0);
  if (reference <= 0) {
    return Math.floor(strikes.length / 2);
  }

  let bestIndex = 0;
  let bestDistance = Math.abs(strikes[0].strike - reference);
  for (let index = 1; index < strikes.length; index += 1) {
    const distance = Math.abs(strikes[index].strike - reference);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
      continue;
    }
    if (distance === bestDistance && strikes[index].strike > strikes[bestIndex].strike) {
      bestIndex = index;
    }
  }
  return bestIndex;
}

function selectStrikeWindow(strikes, atmIndex, depth = CHAIN_DEPTH) {
  const expected = (depth * 2) + 1;
  if (!Array.isArray(strikes) || strikes.length === 0 || atmIndex < 0) {
    return [];
  }
  if (strikes.length <= expected) {
    return strikes.slice();
  }

  let start = atmIndex - depth;
  let end = atmIndex + depth;

  if (start < 0) {
    end += -start;
    start = 0;
  }
  if (end >= strikes.length) {
    start -= (end - strikes.length + 1);
    end = strikes.length - 1;
  }

  if (start < 0) {
    start = 0;
  }
  if ((end - start + 1) > expected) {
    end = start + expected - 1;
  }
  if ((end - start + 1) < expected) {
    start = Math.max(0, end - expected + 1);
  }

  return strikes.slice(start, end + 1);
}

function legFromStrike({
  symbol,
  strike,
  atmStrike,
  type,
  leg,
  symbolLookup
}) {
  const strikeValue = asFiniteNumber(strike, 0);
  const symbolKey = `${strikeKey(strikeValue)}:${type}`;
  const fallbackSymbol = `NFO:${String(symbol || "NIFTY").toUpperCase()}${Math.round(strikeValue)}${type}`;
  const resolvedSymbol = String(symbolLookup.get(symbolKey) || fallbackSymbol);
  const distanceFromAtm = round(strikeValue - atmStrike, 2);
  const position = distanceFromAtm === 0 ? "ATM" : (distanceFromAtm > 0 ? "ABOVE_ATM" : "BELOW_ATM");

  return {
    symbol: resolvedSymbol,
    type,
    strike: strikeValue,
    oi: Math.round(asFiniteNumber(leg?.oi, 0)),
    volume: Math.round(asFiniteNumber(leg?.volume, 0)),
    iv: round(asFiniteNumber(leg?.iv, 0), 2),
    ltp: round(asFiniteNumber(leg?.ltp, 0), 2),
    distanceFromAtm,
    position
  };
}

function build42LegOptionChain(snapshot, depth = CHAIN_DEPTH) {
  const orderedStrikes = sortSnapshotStrikes(snapshot);
  if (!orderedStrikes.length) {
    return {
      expectedStrikeCount: EXPECTED_STRIKE_COUNT,
      expectedLegCount: EXPECTED_LEG_COUNT,
      strikeCount: 0,
      legCount: 0,
      atmStrike: 0,
      legs: [],
      oiBySymbol: {},
      valid: false
    };
  }

  const underlying = asFiniteNumber(snapshot?.underlying, 0);
  const atmIndex = findAtmIndex(orderedStrikes, underlying);
  const atmStrike = asFiniteNumber(orderedStrikes[atmIndex]?.strike, 0);
  const selectedStrikes = selectStrikeWindow(orderedStrikes, atmIndex, depth);
  const symbolLookup = buildLegSymbolLookup(snapshot);
  const legs = [];
  const oiBySymbol = {};

  for (const strike of selectedStrikes) {
    const ceLeg = legFromStrike({
      symbol: snapshot?.symbol,
      strike: strike.strike,
      atmStrike,
      type: "CE",
      leg: strike.call,
      symbolLookup
    });
    const peLeg = legFromStrike({
      symbol: snapshot?.symbol,
      strike: strike.strike,
      atmStrike,
      type: "PE",
      leg: strike.put,
      symbolLookup
    });
    legs.push(ceLeg, peLeg);
    oiBySymbol[ceLeg.symbol] = ceLeg.oi;
    oiBySymbol[peLeg.symbol] = peLeg.oi;
  }

  return {
    expectedStrikeCount: EXPECTED_STRIKE_COUNT,
    expectedLegCount: EXPECTED_LEG_COUNT,
    strikeCount: selectedStrikes.length,
    legCount: legs.length,
    atmStrike,
    legs,
    oiBySymbol,
    valid: selectedStrikes.length === EXPECTED_STRIKE_COUNT && legs.length === EXPECTED_LEG_COUNT
  };
}

function hasSnapshotOptionData(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return false;
  }
  if (Array.isArray(snapshot.strikes) && snapshot.strikes.length > 0) {
    return true;
  }
  if (Array.isArray(snapshot.rows) && snapshot.rows.length > 0) {
    return true;
  }
  if (snapshot.data && typeof snapshot.data === "object" && Object.keys(snapshot.data).length > 0) {
    return true;
  }
  return false;
}

function summarizeSnapshot(snapshot) {
  const strikes = sortSnapshotStrikes(snapshot);
  let callOiTotal = 0;
  let putOiTotal = 0;
  for (const strike of strikes) {
    callOiTotal += asFiniteNumber(strike.call?.oi, 0);
    putOiTotal += asFiniteNumber(strike.put?.oi, 0);
  }
  const totalOi = callOiTotal + putOiTotal;
  const pcr = callOiTotal > 0 ? (putOiTotal / callOiTotal) : 0;
  return {
    callOiTotal,
    putOiTotal,
    totalOi,
    pcr
  };
}

function buildHighestOi(snapshot) {
  const strikes = sortSnapshotStrikes(snapshot);
  let callStrike = 0;
  let callOI = 0;
  let putStrike = 0;
  let putOI = 0;
  for (const strike of strikes) {
    const currentCallOi = asFiniteNumber(strike.call?.oi, 0);
    const currentPutOi = asFiniteNumber(strike.put?.oi, 0);
    if (currentCallOi > callOI) {
      callOI = currentCallOi;
      callStrike = strike.strike;
    }
    if (currentPutOi > putOI) {
      putOI = currentPutOi;
      putStrike = strike.strike;
    }
  }
  const timestamp = normalizeTimestamp(snapshot?.timestamp) || 0;
  return {
    callStrike,
    callOI,
    callTimestamp: timestamp,
    putStrike,
    putOI,
    putTimestamp: timestamp
  };
}

function buildStrikeOiMap(snapshot) {
  const strikes = sortSnapshotStrikes(snapshot);
  const out = new Map();
  for (const strike of strikes) {
    out.set(strikeKey(strike.strike), {
      callOi: asFiniteNumber(strike.call?.oi, 0),
      putOi: asFiniteNumber(strike.put?.oi, 0)
    });
  }
  return out;
}

function buildOptionMetricsFromSnapshots({
  symbol = "NIFTY",
  startTimestamp,
  endTimestamp,
  startSnapshot,
  endSnapshot,
  latestSnapshot = null
}) {
  const startResolved = normalizeTimestamp(startSnapshot?.timestamp) || normalizeTimestamp(startTimestamp) || 0;
  const endResolved = normalizeTimestamp(endSnapshot?.timestamp) || normalizeTimestamp(endTimestamp) || 0;
  const startTotals = summarizeSnapshot(startSnapshot);
  const endTotals = summarizeSnapshot(endSnapshot);
  const latest = latestSnapshot || endSnapshot;
  const latestTotals = summarizeSnapshot(latest);

  const startMap = buildStrikeOiMap(startSnapshot);
  const endMap = buildStrikeOiMap(endSnapshot);
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
    symbol: String(symbol || endSnapshot?.symbol || "NIFTY"),
    source: String(latest?.source || endSnapshot?.source || startSnapshot?.source || "proxy:snapshot"),
    interval: String(latest?.interval || endSnapshot?.interval || startSnapshot?.interval || "1m"),
    startTimestamp: normalizeTimestamp(startTimestamp) || startResolved,
    endTimestamp: normalizeTimestamp(endTimestamp) || endResolved,
    ts1: {
      requestTimestamp: normalizeTimestamp(startTimestamp) || startResolved,
      resolvedTimestamp: startResolved,
      exactMatch: startResolved === (normalizeTimestamp(startTimestamp) || startResolved),
      snapshot: startSnapshot
    },
    ts2: {
      requestTimestamp: normalizeTimestamp(endTimestamp) || endResolved,
      resolvedTimestamp: endResolved,
      exactMatch: endResolved === (normalizeTimestamp(endTimestamp) || endResolved),
      snapshot: endSnapshot
    },
    selected: {
      snapshotCount: startResolved === endResolved ? 1 : 2,
      callOiTotal: Math.round(selectedCallOiTotal),
      putOiTotal: Math.round(selectedPutOiTotal),
      totalOi: Math.round(selectedTotalOi),
      pcr: Number.isFinite(selectedPcr) ? round(selectedPcr, 2) : 0
    },
    session: {
      snapshotCount: 1,
      callOiTotal: Math.round(latestTotals.callOiTotal),
      putOiTotal: Math.round(latestTotals.putOiTotal),
      totalOi: Math.round(latestTotals.totalOi),
      pcr: Number.isFinite(latestTotals.pcr) ? round(latestTotals.pcr, 4) : 0,
      sessionStartTimestamp: normalizeTimestamp(startTimestamp) || startResolved,
      sessionLatestTimestamp: normalizeTimestamp(latest?.timestamp) || endResolved
    },
    netOiChange: {
      totalTs1: round(startTotals.totalOi, 1),
      totalTs2: round(endTotals.totalOi, 1),
      net: round(net, 1),
      pct: Number.isFinite(netPct) ? round(netPct, 2) : 0
    },
    highestOI: buildHighestOi(latest),
    startSnapshot,
    endSnapshot,
    latestSnapshot: latest
  };
}

export {
  CHAIN_DEPTH,
  EXPECTED_STRIKE_COUNT,
  EXPECTED_LEG_COUNT,
  asFiniteNumber,
  round,
  normalizeTimestamp,
  getPreviousTradingDayTimestampCandidates,
  getClosedMinuteCutoffIST,
  clampToClosedMinute,
  hasSnapshotOptionData,
  build42LegOptionChain,
  summarizeSnapshot,
  buildHighestOi,
  buildOptionMetricsFromSnapshots
};
