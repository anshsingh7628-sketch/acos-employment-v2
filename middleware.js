import { NextResponse } from "next/server";

const OPEN = ["/", "/login", "/privacy", "/security"];

export function middleware(request) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api") || pathname.startsWith("/_next") || pathname.includes(".")) {
    return NextResponse.next();
  }
  const session = request.cookies.get("aco_session")?.value;
  if (pathname.startsWith("/work") && !session) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (pathname === "/login" && session) {
    return NextResponse.redirect(new URL("/work", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/work/:path*", "/login"] };
