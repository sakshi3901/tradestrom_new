import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { isGmail } from "@/lib/email";

async function getLiveAccess(email) {
  const goApiBaseUrl = process.env.GO_API_BASE_URL;
  const internalSecret = process.env.INTERNAL_API_SECRET;

  if (!goApiBaseUrl || !internalSecret) {
    throw new Error("Missing GO_API_BASE_URL or INTERNAL_API_SECRET");
  }

  const response = await fetch(
    `${goApiBaseUrl}/v1/access/check?email=${encodeURIComponent(email)}`,
    {
      headers: {
        "X-Internal-Secret": internalSecret
      },
      cache: "no-store"
    }
  );

  if (!response.ok) {
    throw new Error("Failed to validate access against backend");
  }

  return response.json();
}

export async function middleware(request) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET
  });

  if (!token?.email) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!isGmail(token.email)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  let access;
  try {
    access = await getLiveAccess(token.email);
  } catch (error) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!access?.allowed) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (
    request.nextUrl.pathname.startsWith("/admin") &&
    access.role !== "admin"
  ) {
    return NextResponse.redirect(new URL("/home", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/home/:path*", "/admin/:path*", "/nifty-contribution/:path*", "/videos/:path*", "/community/:path*"]
};
