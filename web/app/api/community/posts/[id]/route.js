import { NextResponse } from "next/server";
import { requireMarketAccess } from "@/lib/routeAccess";
import { deleteCommunityPost } from "@/lib/api";

export async function DELETE(_request, { params }) {
  const auth = await requireMarketAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const postId = String(params?.id || "").trim();
  if (!postId) {
    return NextResponse.json({ error: "post id is required" }, { status: 400 });
  }

  try {
    const result = await deleteCommunityPost({
      userEmail: auth.session.user.email,
      postId
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return NextResponse.json(
      { error: error.message || "Failed to delete community post" },
      { status }
    );
  }
}
