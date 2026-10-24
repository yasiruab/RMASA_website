import { NextResponse, type NextRequest } from "next/server";
import { buildAdminCsp } from "@/lib/csp";

// Strict, nonce-based Content-Security-Policy for the admin pages (audit F14).
// A fresh nonce per request goes on the *request* headers, which is where
// Next's renderer reads it to stamp its own inline scripts, and on the response,
// which is what the browser enforces. Public routes keep the static policy from
// next.config.ts; see src/lib/csp.ts for why the two differ.
export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildAdminCsp(nonce, process.env.NODE_ENV !== "production");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Admin pages only, excluding prefetches: a prefetched RSC payload is not an
  // HTML document, and a nonce minted for it would never match the page's.
  matcher: [
    {
      source: "/admin/:path*",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    {
      source: "/admin",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
