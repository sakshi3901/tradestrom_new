import { NextResponse } from "next/server";
import { fetchMovers } from "@/lib/api";
import { requireMarketAccess } from "@/lib/routeAccess";

export async function GET(request) {
  const auth = await requireMarketAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const params = request.nextUrl.searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const interval = params.get("interval") || "1m";
  const limit = params.get("limit") || "50";

  if (!from || !to) {
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }

  try {
    const payload = await fetchMovers({ from, to, interval, limit });
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch movers" },
      { status: 500 }
    );
  }
}
