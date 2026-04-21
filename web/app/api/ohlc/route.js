import { NextResponse } from "next/server";
import { fetchOhlc } from "@/lib/api";
import { requireMarketAccess } from "@/lib/routeAccess";

function normalizeUnixSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  if (numeric > 1_000_000_000_000) {
    return Math.floor(numeric / 1000);
  }
  return Math.floor(numeric);
}

function getISTDatePartsFromUnix(unixSeconds) {
  const date = new Date(unixSeconds * 1000);
  const istDate = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return {
    year: istDate.getFullYear(),
    month: istDate.getMonth(),
    day: istDate.getDate(),
    weekday: istDate.getDay()
  };
}

function getISTTodayParts() {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return {
    year: istNow.getFullYear(),
    month: istNow.getMonth(),
    day: istNow.getDate(),
    weekday: istNow.getDay()
  };
}

function isSameISTDate(a, b) {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function isWeekendByParts(parts) {
  return parts.weekday === 0 || parts.weekday === 6;
}

function getPreviousTradingDateParts(baseParts) {
  const cursor = new Date(Date.UTC(baseParts.year, baseParts.month, baseParts.day, 0, 0, 0, 0));
  do {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const local = new Date(cursor.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    if (local.getDay() !== 0 && local.getDay() !== 6) {
      return {
        year: local.getFullYear(),
        month: local.getMonth(),
        day: local.getDate(),
        weekday: local.getDay()
      };
    }
  } while (true);
}

function getSessionRangeUnixForISTDate(parts) {
  // 09:15 IST = 03:45 UTC, 15:30 IST = 10:00 UTC
  const from = Math.floor(Date.UTC(parts.year, parts.month, parts.day, 3, 45, 0, 0) / 1000);
  const to = Math.floor(Date.UTC(parts.year, parts.month, parts.day, 10, 0, 0, 0) / 1000);
  return { from, to };
}

function hasCandles(payload) {
  return Array.isArray(payload?.candles) && payload.candles.length > 0;
}

export async function GET(request) {
  const auth = await requireMarketAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const params = request.nextUrl.searchParams;
  const symbol = params.get("symbol") || "NIFTY50";
  const from = params.get("from");
  const to = params.get("to");
  const interval = params.get("interval") || "1m";

  if (!from || !to) {
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }

  const fromUnix = normalizeUnixSeconds(from);
  const toUnix = normalizeUnixSeconds(to);
  if (!fromUnix || !toUnix || toUnix <= fromUnix) {
    return NextResponse.json({ error: "invalid from/to range" }, { status: 400 });
  }

  const requestFromIST = getISTDatePartsFromUnix(fromUnix);
  const todayIST = getISTTodayParts();
  const requestIsTodayIST = isSameISTDate(requestFromIST, todayIST);
  const shouldHolidayFallback = requestIsTodayIST || isWeekendByParts(todayIST);

  const fallbackParts = getPreviousTradingDateParts(todayIST);
  const fallbackRange = getSessionRangeUnixForISTDate(fallbackParts);

  try {
    const payload = await fetchOhlc({ symbol, from: fromUnix, to: toUnix, interval });
    if (hasCandles(payload) || !shouldHolidayFallback) {
      return NextResponse.json(payload, { status: 200 });
    }

    const fallbackPayload = await fetchOhlc({
      symbol,
      from: fallbackRange.from,
      to: fallbackRange.to,
      interval
    });
    return NextResponse.json(
      {
        ...fallbackPayload,
        fallback: {
          applied: true,
          reason: "today_empty_or_holiday",
          from: fallbackRange.from,
          to: fallbackRange.to
        }
      },
      { status: 200 }
    );
  } catch (error) {
    if (shouldHolidayFallback) {
      try {
        const fallbackPayload = await fetchOhlc({
          symbol,
          from: fallbackRange.from,
          to: fallbackRange.to,
          interval
        });
        if (hasCandles(fallbackPayload)) {
          return NextResponse.json(
            {
              ...fallbackPayload,
              fallback: {
                applied: true,
                reason: "today_error_or_holiday",
                from: fallbackRange.from,
                to: fallbackRange.to
              }
            },
            { status: 200 }
          );
        }
      } catch {
        // continue to original error below
      }
    }
    return NextResponse.json(
      { error: error.message || "Failed to fetch ohlc" },
      { status: 500 }
    );
  }
}
