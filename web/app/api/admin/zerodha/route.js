import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  checkAccess,
  getAdminZerodhaSettings,
  updateAdminZerodhaSettings
} from "@/lib/api";

async function authorizeAdmin() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const access = await checkAccess(session.user.email).catch(() => ({
    allowed: false,
    role: "client"
  }));

  if (!access.allowed || access.role !== "admin") {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: true, session };
}

export async function GET() {
  const auth = await authorizeAdmin();

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const payload = await getAdminZerodhaSettings();
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch Zerodha settings" },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  const auth = await authorizeAdmin();

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const apiKey = String(body.apiKey || "").trim();
  const apiSecret = String(body.apiSecret || "").trim();
  const accessToken = String(body.accessToken || "").trim();

  if (!apiKey && !apiSecret && !accessToken) {
    return NextResponse.json(
      { error: "Provide at least one field to update" },
      { status: 400 }
    );
  }

  try {
    const payload = await updateAdminZerodhaSettings({
      apiKey,
      apiSecret,
      accessToken,
      actorEmail: auth.session.user.email
    });

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to update Zerodha settings" },
      { status: 500 }
    );
  }
}
