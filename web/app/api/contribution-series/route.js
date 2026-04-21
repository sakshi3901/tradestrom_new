import { NextResponse } from "next/server";
import { fetchContributionSeries } from "@/lib/api";
import { requireMarketAccess } from "@/lib/routeAccess";

const contributionSeriesCache = new Map();
const contributionSeriesInflight = new Map();
const FULL_SERIES_TTL_MS = 10 * 1000;
const SELECTED_SERIES_TTL_MS = 2 * 1000;

export async function GET(request) {
  const auth = await requireMarketAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const params = request.nextUrl.searchParams;
  const symbol = params.get("symbol") || undefined;
  const interval = params.get("interval") || "1m";
  const at = params.get("at") || undefined;
  const onlySelected = params.get("only_selected") || undefined;
  const cacheKey = `${symbol || "NIFTY50"}|${interval}|${at || ""}|${String(onlySelected || "")}`;
  const isOnlySelected = String(onlySelected).toLowerCase() === "true" || String(onlySelected) === "1";
  const now = Date.now();
  const cached = contributionSeriesCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.payload, { status: 200 });
  }

  if (contributionSeriesInflight.has(cacheKey)) {
    try {
      const payload = await contributionSeriesInflight.get(cacheKey);
      return NextResponse.json(payload, { status: 200 });
    } catch (error) {
      return NextResponse.json(
        { error: error.message || "Failed to fetch contribution series" },
        { status: 500 }
      );
    }
  }

  try {
    const buildPromise = fetchContributionSeries({ symbol, interval, at, onlySelected });
    contributionSeriesInflight.set(cacheKey, buildPromise);
    const payload = await buildPromise;
    contributionSeriesCache.set(cacheKey, {
      payload,
      expiresAt: Date.now() + (isOnlySelected ? SELECTED_SERIES_TTL_MS : FULL_SERIES_TTL_MS)
    });
    if (contributionSeriesCache.size > 24) {
      const firstKey = contributionSeriesCache.keys().next().value;
      contributionSeriesCache.delete(firstKey);
    }
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch contribution series" },
      { status: 500 }
    );
  } finally {
    contributionSeriesInflight.delete(cacheKey);
  }
}
