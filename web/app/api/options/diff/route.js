import { NextResponse } from "next/server";
import { fetchOptionDiff } from "@/lib/api";
import { requireMarketAccess } from "@/lib/routeAccess";

export async function GET(request) {
  const auth = await requireMarketAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const params = request.nextUrl.searchParams;
  const symbol = params.get("symbol") || "NIFTY";
  const from = params.get("from");
  const to = params.get("to");
  const limit = params.get("limit") || "10";

  if (!from || !to) {
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }

  try {
    const payload = await fetchOptionDiff({ symbol, from, to, limit });
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch option diff" },
      { status: 500 }
    );
  }
}
