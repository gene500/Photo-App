import { assertSameOrigin, jsonError } from "./http";
import { clientIp, hit, isBlocked } from "./rate-limit";
import { RATE_LIMITED } from "./auth";

/**
 * Runs before NextAuth handles a POST: cross-site check, then the per-IP (all attempts) and per-email (failed
 * attempts) login throttles. Returns the response to send when the request must not proceed.
 * The 429 body mimics NextAuth's JSON so `signIn(..., { redirect: false })` reports `error: "RateLimited"`.
 */
export async function guardAuthPost(req: Request): Promise<Response | null> {
  try {
    assertSameOrigin(req);
  } catch {
    return jsonError(403, "Cross-site request refused");
  }
  const url = new URL(req.url);
  if (!url.pathname.endsWith("/callback/credentials")) return null;

  const limited = (retryAfter: number) =>
    Response.json(
      { url: `${url.origin}/login?error=${RATE_LIMITED}` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  const ip = hit("login-ip", clientIp(req.headers));
  if (!ip.ok) return limited(ip.retryAfter);

  let email = "";
  try {
    email = String((await req.clone().formData()).get("email") ?? "").trim().toLowerCase();
  } catch {
    // Not a form post; NextAuth will reject it.
  }
  if (email) {
    const blocked = isBlocked("login-email-failures", email);
    if (!blocked.ok) return limited(blocked.retryAfter);
  }
  return null;
}
