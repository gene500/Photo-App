import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Cheap bot deterrent that needs no external service. The signup page embeds a server-signed timestamp; the signup
 * request must carry it back and not arrive sooner than a human could fill the form (or implausibly late).
 * A hidden "website" field that only bots fill in is the second signal. Neither stops a determined script, they
 * just remove the laziest bots; the per-IP and per-email rate limits do the rest.
 */

const MAX_AGE_MS = 6 * 60 * 60 * 1000;
// If NEXTAUTH_SECRET is missing (never in production: NextAuth refuses to run), tokens last one process only.
const fallbackSecret = randomBytes(32).toString("hex");

const secret = () => process.env.NEXTAUTH_SECRET || fallbackSecret;
const sign = (ts: string) => createHmac("sha256", secret()).update(`signup:${ts}`).digest("base64url");
const minAgeMs = () => {
  const s = Number(process.env.SIGNUP_MIN_SECONDS ?? 3);
  return (Number.isFinite(s) && s >= 0 ? s : 3) * 1000;
};

export function issueSignupToken(now = Date.now()): string {
  const ts = String(now);
  return `${ts}.${sign(ts)}`;
}

export type SignupTokenCheck = "ok" | "invalid" | "too-fast" | "expired";

export function checkSignupToken(token: string | undefined, now = Date.now()): SignupTokenCheck {
  const [ts, mac, extra] = (token ?? "").split(".");
  if (!ts || !mac || extra !== undefined || !/^\d{1,16}$/.test(ts)) return "invalid";
  const want = Buffer.from(sign(ts));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return "invalid";
  const age = now - Number(ts);
  if (age < minAgeMs()) return "too-fast";
  if (age > MAX_AGE_MS) return "expired";
  return "ok";
}
