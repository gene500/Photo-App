import { NextResponse, type NextRequest } from "next/server";
import { clientIp, hit, POLICIES } from "@/server/rate-limit";

/**
 * The public share page /s/[token] is rendered (and queries the database) on every hit, with no login. This caps the
 * renders per client address; the limit is generous so only a flood reaches it. It runs here, not in the page, so the
 * answer can be a real 429. In-memory per instance, like the other cheap limits (see src/server/rate-limit.ts).
 */
export function proxy(req: NextRequest) {
  const r = hit("share-view", clientIp(req.headers));
  if (r.ok) return NextResponse.next();
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

export const config = { matcher: ["/s/:path*"] };
