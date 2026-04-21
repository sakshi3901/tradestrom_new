import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { checkAccess, updateAdminCommunityPostStatus } from "@/lib/api";

export async function POST(request, { params }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await checkAccess(session.user.email).catch(() => ({ allowed: false, role: "client" }));
  if (!access.allowed || access.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const postId = String(params?.id || "").trim();
  if (!postId) {
    return NextResponse.json({ error: "post id is required" }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const status = String(body?.status || "").trim().toLowerCase();
  if (status !== "approved" && status !== "rejected" && status !== "pending") {
    return NextResponse.json(
      { error: "status must be approved, rejected, or pending" },
      { status: 400 }
    );
  }

  try {
    const result = await updateAdminCommunityPostStatus({
      actorEmail: session.user.email,
      postId,
      status
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const code = Number(error?.status) || 500;
    return NextResponse.json(
      { error: error.message || "Failed to update post status" },
      { status: code }
    );
  }
}
