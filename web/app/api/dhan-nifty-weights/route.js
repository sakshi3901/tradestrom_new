import { NextResponse } from "next/server";
import { requireMarketAccess } from "@/lib/routeAccess";

const DHAN_NIFTY_50_URL = "https://dhan.co/indices/nifty-50-companies/";
const DHAN_CACHE_TTL_MS = 60 * 1000;
const DHAN_FETCH_TIMEOUT_MS = 7000;

let dhanWeightsCache = {
  payload: null,
  cachedAt: 0
};
let dhanWeightsInFlight = null;

function asFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (!match?.[1]) {
    throw new Error("Dhan page __NEXT_DATA__ not found");
  }

  try {
    return JSON.parse(match[1]);
  } catch {
    throw new Error("Failed to parse Dhan page data");
  }
}

export async function GET() {
  const auth = await requireMarketAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const now = Date.now();
    if (dhanWeightsCache.payload && (now - dhanWeightsCache.cachedAt) < DHAN_CACHE_TTL_MS) {
      return NextResponse.json(dhanWeightsCache.payload, { status: 200 });
    }

    if (!dhanWeightsInFlight) {
      dhanWeightsInFlight = (async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DHAN_FETCH_TIMEOUT_MS);
        try {
          const response = await fetch(DHAN_NIFTY_50_URL, {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 Tradestrom/1.0",
              Accept: "text/html,application/xhtml+xml"
            }
          });

          const html = await response.text();
          if (!response.ok) {
            throw new Error(`Dhan page request failed (${response.status})`);
          }

          const nextData = extractNextData(html);
          const pageProps = nextData?.props?.pageProps || {};
          const rows = Array.isArray(pageProps?.sniData) ? pageProps.sniData : [];

          if (!rows.length) {
            throw new Error("Dhan sniData is empty");
          }

          const parsedRows = rows
            .map((row) => {
              const symbol = String(row?.Sym || "").trim().toUpperCase();
              const mcap = asFiniteNumber(row?.Mcap, 0);
              return {
                symbol,
                mcap,
                ltp: asFiniteNumber(row?.Ltp, 0),
                per_change: asFiniteNumber(row?.PPerchange, 0)
              };
            })
            .filter((row) => row.symbol && row.mcap > 0);

          const totalMcap = parsedRows.reduce((sum, row) => sum + row.mcap, 0);
          if (!(totalMcap > 0)) {
            throw new Error("Dhan total market cap is invalid");
          }

          const weights = {};
          for (const row of parsedRows) {
            weights[row.symbol] = {
              weight_mcap_pct: (row.mcap / totalMcap) * 100,
              mcap: row.mcap,
              ltp: row.ltp,
              per_change: row.per_change
            };
          }

          return {
            source: "dhan",
            url: DHAN_NIFTY_50_URL,
            generated_at: Math.floor(Date.now() / 1000),
            symbol_count: parsedRows.length,
            total_mcap: totalMcap,
            weights
          };
        } finally {
          clearTimeout(timeoutId);
        }
      })();
    }

    try {
      const payload = await dhanWeightsInFlight;
      dhanWeightsCache = {
        payload,
        cachedAt: Date.now()
      };
      return NextResponse.json(payload, { status: 200 });
    } finally {
      dhanWeightsInFlight = null;
    }
  } catch (error) {
    if (dhanWeightsCache.payload) {
      return NextResponse.json(
        {
          ...dhanWeightsCache.payload,
          stale: true,
          warning: error?.message || "Failed to refresh Dhan weightage"
        },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { error: error?.message || "Failed to fetch Dhan weightage" },
      { status: 500 }
    );
  }
}
