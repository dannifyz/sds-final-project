import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: skip rendering /admin when there is no session cookie.
// The real check is auth-service /me, which signing-service calls on every /sign.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("session")) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/admin/:path*",
};
