import { assertSameOrigin, HttpError, jsonError, readBodyBytes } from "./http";
import { clientIp } from "./rate-limit";
import { hitShared } from "./shared-limit";
import { loginRefused, RATE_LIMITED } from "./auth";

/** The auth forms are a few short fields; anything bigger is refused before NextAuth buffers it. */
const MAX_AUTH_BODY_BYTES = 16 * 1024;

/**
 * The path as NextAuth sees it: percent-decoded, lowercased, dot and empty segments resolved. Lowercasing and a single
 * decode are deliberately broader than NextAuth's own matching, so over-matching only throttles more, never less.
 */
function decodedSegments(pathname: string): string[] {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes: match on the raw path, which still catches the plain spelling.
  }
  const out: string[] = [];
  for (const seg of path.toLowerCase().split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out;
}

const isCredentialsCallback = (pathname: string) => {
  // NextAuth reads only the first two segments after /api/auth, so anything after `credentials` is ignored too.
  const segs = decodedSegments(pathname);
  const at = segs.findIndex((seg, i) => seg === "api" && segs[i + 1] === "auth");
  return at >= 0 && segs[at + 2] === "callback" && segs[at + 3] === "credentials";
};

/**
 * Runs before NextAuth handles a POST: cross-site check, body size cap, then the per-IP (all attempts) and per-email-and-address
 * (failed attempts) login throttles. Returns the response to send when the request must not proceed.
 * The 429 body mimics NextAuth's JSON so `signIn(..., { redirect: false })` reports `error: "RateLimited"`.
 */
export async function guardAuthPost(req: Request): Promise<Response | null> {
  try {
    assertSameOrigin(req);
  } catch {
    return jsonError(403, "Cross-site request refused");
  }
  let body: Uint8Array;
  try {
    body = await readBodyBytes(req.clone(), MAX_AUTH_BODY_BYTES);
  } catch (e) {
    if (e instanceof HttpError) return jsonError(e.status, e.message);
    throw e;
  }
  const url = new URL(req.url);
  if (!isCredentialsCallback(url.pathname)) return null;

  const limited = (retryAfter: number) =>
    Response.json(
      { url: `${url.origin}/login?error=${RATE_LIMITED}` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  const ip = await hitShared("login-ip", clientIp(req.headers));
  if (!ip.ok) return limited(ip.retryAfter);

  let email = "";
  try {
    const type = req.headers.get("content-type") ?? "";
    const form = await new Response(body as BodyInit, { headers: { "content-type": type } }).formData();
    email = String(form.get("email") ?? "").trim().toLowerCase();
  } catch {
    // Not a form post; NextAuth will reject it.
  }
  // An over-long email can never be a real account; authorize rejects it too, so it never becomes a limiter key.
  if (email && email.length <= 254) {
    const blocked = await loginRefused(email, clientIp(req.headers));
    if (!blocked.ok) return limited(blocked.retryAfter);
  }
  return null;
}

/** `new URL` would throw on this callbackUrl (NextAuth then answers a bare 500), so it is treated as absent. */
const unparseable = (value: string, base: string) => {
  try {
    new URL(value, base);
    return false;
  } catch {
    return true;
  }
};

/**
 * Returns the request NextAuth should handle: an unparseable `callbackUrl` (query or form body) is dropped so the
 * default callback applies instead of a 500. Other requests are returned as they are.
 */
export async function sanitizeAuthRequest<T extends Request>(req: T): Promise<Request | T> {
  const url = new URL(req.url);
  const bad = (v: string | null) => v !== null && unparseable(v, url.origin);
  let out: Request | T = req;
  if (bad(url.searchParams.get("callbackUrl"))) {
    url.searchParams.delete("callbackUrl");
    out = new Request(url, req);
  }
  if (req.method === "POST" && (req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(await req.clone().text());
    if (bad(form.get("callbackUrl"))) {
      form.delete("callbackUrl");
      const headers = new Headers(out.headers);
      headers.delete("content-length");
      out = new Request(out.url, { method: "POST", headers, body: form });
    }
  }
  return out;
}
