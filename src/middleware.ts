import { NextResponse, type NextRequest } from "next/server";
import { auth0 } from "@/lib/auth0";

export async function middleware(req: NextRequest) {
  const res = await auth0.middleware(req);
  const path = req.nextUrl.pathname;
  // /auth/* ditangani SDK; /api/inngest diverifikasi oleh signing key Inngest.
  if (path.startsWith("/auth") || path.startsWith("/api/inngest")) return res;
  if (!(await auth0.getSession(req))) return NextResponse.redirect(new URL("/auth/login", req.nextUrl.origin));
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
