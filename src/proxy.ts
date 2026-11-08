import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "@/lib/security-headers";
import { clientIp, hit, POLICIES } from "@/server/rate-limit";

/**
 * Runs before every page request (not build assets or the image optimizer). The API is NOT matched, except for paths that hold a
 * `%`, where it only rejects broken percent-encoding. Reason: Next buffers a request body (up to 10 MB, then logs a warning)
 * before the proxy answers, so matching the whole API would hold every upload and POST until its body had fully arrived and
 * lose the early 401 / 413 the routes give from the headers alone. Real API paths are plain ids and never contain `%`.
 * On pages:
 * 1. The public share page /s/[token] is rendered (and queries the database) on every hit, with no login. This caps the
 *    renders per client address; the limit is generous so only a flood reaches it. It runs here, not in the page, so the
 *    answer can be a real 429. In-memory per instance, like the other cheap limits (see src/server/rate-limit.ts).
 * 2. It gives the page a Content-Security-Policy with a fresh nonce, so no inline script runs unless it carries that nonce
 *    (Next adds it to its own scripts from the request's CSP header; the root layout reads `x-nonce` for the theme script).
 *    Pages must therefore render per request: the root layout reads the nonce, which makes every page dynamic.
 */
const isApiPath = (p: string) => p === "/api" || p.startsWith("/api/");

/** True when the path has a % not followed by two hex digits, or escapes that do not decode to valid UTF-8. */
export function hasBadPercentEncoding(pathname: string): boolean {
  try {
    decodeURIComponent(pathname);
    return false;
  } catch {
    return true;
  }
}

export function proxy(req: NextRequest) {
  // A path with broken percent-encoding (/api/trips/%, /s/%E0%A4%A) would reach Next's param decoding and end as a 500 in
  // production. Answer 400 here instead (JSON under /api).
  if (hasBadPercentEncoding(new URL(req.url).pathname)) {
    return isApiPath(req.nextUrl.pathname)
      ? Response.json({ error: "Invalid URL" }, { status: 400, headers: { "Cache-Control": "private, no-store" } })
      : new NextResponse("Invalid URL", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });
  }
  // The API has its own locked-down CSP (next.config.ts) and needs no nonce.
  if (isApiPath(req.nextUrl.pathname)) return NextResponse.next();
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
  const https = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
  const csp = contentSecurityPolicy(process.env.NODE_ENV !== "production", nonce, process.env.NODE_ENV === "production" && https);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // 1. Pages: not the API, build assets, the image optimizer, or the public files (icons, fonts, manifest, service worker,
  //    favicon and the other static files). Prefetches are not excluded: a header the client controls must not be able to skip
  //    the share-page limit. The segment match is exact (`api/` or `api` alone), so a page such as /apiary or /icons-guide still
  //    gets the CSP. The API's own headers are in next.config.ts.
  // 2. API paths containing a `%`, only for the bad-encoding check above (see the comment at the top of this file).
  matcher: ["/((?!(?:_next/static|_next/image|icons|fonts|api)(?:/|$)|(?:manifest\\.webmanifest|sw\\.js|favicon\\.ico)$).*)", "/api/:rest(.*%.*)"],
};
