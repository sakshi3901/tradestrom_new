import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { checkAccess, fetchAdminCommunityPosts } from "@/lib/api";

export async function GET(request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await checkAccess(session.user.email).catch(() => ({ allowed: false, role: "client" }));
  if (!access.allowed || access.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const status = String(params.get("status") || "pending").trim();
  const category = String(params.get("category") || "All").trim();
  const rawLimit = Number(params.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.trunc(rawLimit), 300) : 30;

  const rawPage = Number(params.get("page"));
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.trunc(rawPage) : 1;

  const offsetParam = params.get("offset");
  const rawOffset = Number(offsetParam);
  const hasOffset = offsetParam !== null && offsetParam !== "";
  const offset = hasOffset && Number.isFinite(rawOffset) && rawOffset >= 0
    ? Math.trunc(rawOffset)
    : (page - 1) * limit;

  try {
    const result = await fetchAdminCommunityPosts({
      actorEmail: session.user.email,
      status,
      category,
      limit,
      offset
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const code = Number(error?.status) || 500;
    return NextResponse.json(
      { error: error.message || "Failed to load admin community posts" },
      { status: code }
    );
  }
}
