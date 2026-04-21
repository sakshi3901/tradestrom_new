import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { checkAccess, listUsersByRole } from "@/lib/api";

const allowedRoles = new Set(["admin", "client"]);

export async function GET(request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await checkAccess(session.user.email).catch(() => ({ allowed: false, role: "client" }));

  if (!access.allowed || access.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const role = request.nextUrl.searchParams.get("role");

  if (!role || !allowedRoles.has(role)) {
    return NextResponse.json({ error: "Invalid role filter" }, { status: 400 });
  }

  try {
    const result = await listUsersByRole(role);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to list users" },
      { status: 500 }
    );
  }
}
