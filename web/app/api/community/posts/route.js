import { NextResponse } from "next/server";
import { requireMarketAccess } from "@/lib/routeAccess";
import { createCommunityPost, fetchCommunityPosts } from "@/lib/api";

export async function GET(request) {
  const auth = await requireMarketAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const params = request.nextUrl.searchParams;
  const scope = String(params.get("scope") || "all").trim().toLowerCase();
  const category = String(params.get("category") || "All").trim();
  const requestedLimit = Number(params.get("limit") || 30);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(30, Math.floor(requestedLimit))
    : 30;
  const requestedPage = Number(params.get("page") || 1);
  const page = Number.isFinite(requestedPage) && requestedPage > 0
    ? Math.floor(requestedPage)
    : 1;

  try {
    const result = await fetchCommunityPosts({
      userEmail: auth.session.user.email,
      authorEmail: scope === "mine" ? auth.session.user.email : "",
      category,
      limit,
      page
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return NextResponse.json(
      { error: error.message || "Failed to load community posts" },
      { status }
    );
  }
}

export async function POST(request) {
  const auth = await requireMarketAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await createCommunityPost({
      userEmail: auth.session.user.email,
      category: payload?.category,
      title: payload?.title,
      description: payload?.description,
      primaryImage: payload?.primary_image,
      secondaryImage: payload?.secondary_image
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return NextResponse.json(
      { error: error.message || "Failed to create community post" },
      { status }
    );
  }
}
