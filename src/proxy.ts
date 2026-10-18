import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "@/lib/security-headers";
import { clientIp, hit, POLICIES } from "@/server/rate-limit";

/**
 * Runs before every page request (not the API, build assets or image optimizer):
 * 1. The public share page /s/[token] is rendered (and queries the database) on every hit, with no login. This caps the
 *    renders per client address; the limit is generous so only a flood reaches it. It runs here, not in the page, so the
 *    answer can be a real 429. In-memory per instance, like the other cheap limits (see src/server/rate-limit.ts).
 * 2. It gives the page a Content-Security-Policy with a fresh nonce, so no inline script runs unless it carries that nonce
 *    (Next adds it to its own scripts from the request's CSP header; the root layout reads `x-nonce` for the theme script).
 *    Pages must therefore render per request: the root layout reads the nonce, which makes every page dynamic.
 */
export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/s/")) {
    const r = hit("share-view", clientIp(req.headers));
    if (!r.ok) {
      return new NextResponse(POLICIES["share-view"].message, {
        status: 429,
        headers: {
          "Retry-After": String(r.retryAfter),
          "Cache-Control": "private, no-store",
          "X-Robots-Tag": "noindex, nofollow",
          "Referrer-Policy": "no-referrer",
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(process.env.NODE_ENV !== "production", nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // Pages only: not the API (JSON, locked down in next.config.ts), build assets, the image optimizer, or the public files
  // (icons, fonts, manifest, service worker, favicon and the other static files). Prefetches are not excluded: a header the
  // client controls must not be able to skip the share-page limit. The segment match is exact (`api/` or `api` alone), so a
  // page such as /apiary or /icons-guide still gets the CSP.
  matcher: ["/((?!(?:api|_next/static|_next/image|icons|fonts)(?:/|$)|(?:manifest\\.webmanifest|sw\\.js|favicon\\.ico|file\\.svg|globe\\.svg|next\\.svg|vercel\\.svg|window\\.svg)$).*)"],
};
