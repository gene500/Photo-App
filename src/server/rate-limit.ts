import { HttpError } from "./http";

/**
 * Small fixed-window rate limiter, no dependencies.
 *
 * Tradeoff: counters live in this server instance's memory. On serverless each warm instance has its own counters
 * and a cold start resets them, so the effective limit is "per instance" (a determined attacker spread across many
 * instances gets a multiple of it). That is still enough to stop a single client hammering signup/login or the
 * costly upstream-API routes, and it adds no latency and no database writes. A shared (Turso) counter would make
 * the limit exact but costs a write round trip on every guarded request plus a migration; put Vercel's WAF rate
 * limiting in front if exact global limits are ever needed.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

const MINUTE = 60_000;

/** name -> allowed hits per window. Keys are scoped by the caller (user id, IP, email). */
export const POLICIES = {
  "signup-ip": { limit: 5, windowMs: 60 * MINUTE, message: "Too many sign-up attempts. Try again later." },
  "signup-email": { limit: 3, windowMs: 60 * MINUTE, message: "Too many sign-up attempts. Try again later." },
  "login-ip": { limit: 30, windowMs: 15 * MINUTE, message: "Too many login attempts. Try again later." },
  /** Counts failed logins only, so an attacker cannot lock a victim out by merely submitting requests that succeed. */
  "login-email-failures": { limit: 8, windowMs: 15 * MINUTE, message: "Too many login attempts. Try again later." },
  suggestions: { limit: 30, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
  popularity: { limit: 120, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
  directions: { limit: 60, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
  optimize: { limit: 20, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
  "photo-upload": { limit: 20, windowMs: 10 * MINUTE, message: "Too many uploads. Try again in a few minutes." },
  "place-photo": { limit: 120, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
} as const;
export type PolicyName = keyof typeof POLICIES;

/** Tests set RATE_LIMIT_DISABLED=1 (never honoured in production). */
function disabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.RATE_LIMIT_DISABLED === "1";
}

function sweep(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  // Still full of live buckets (an attack with many distinct keys): drop the oldest rather than grow forever.
  for (const k of buckets.keys()) {
    if (buckets.size < MAX_BUCKETS) break;
    buckets.delete(k);
  }
}

function slot(name: PolicyName, key: string, now: number): Bucket {
  const id = `${name}:${key}`;
  const existing = buckets.get(id);
  if (existing && existing.resetAt > now) return existing;
  sweep(now);
  const fresh = { count: 0, resetAt: now + POLICIES[name].windowMs };
  buckets.set(id, fresh);
  return fresh;
}

export type LimitResult = { ok: true } | { ok: false; retryAfter: number };

function result(name: PolicyName, b: Bucket, now: number): LimitResult {
  return b.count <= POLICIES[name].limit ? { ok: true } : { ok: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
}

/** Counts one hit and reports whether it is still within the limit. */
export function hit(name: PolicyName, key: string, now = Date.now()): LimitResult {
  if (disabled()) return { ok: true };
  const b = slot(name, key, now);
  b.count++;
  return result(name, b, now);
}

/** Whether the next hit would be allowed, without counting it. */
export function isBlocked(name: PolicyName, key: string, now = Date.now()): LimitResult {
  if (disabled()) return { ok: true };
  const b = slot(name, key, now);
  return b.count >= POLICIES[name].limit ? { ok: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) } : { ok: true };
}

export function resetLimit(name: PolicyName, key: string): void {
  buckets.delete(`${name}:${key}`);
}

export function clearAllLimits(): void {
  buckets.clear();
}

/** Counts a hit and throws a 429 (with Retry-After) when over the limit. */
export function enforceLimit(name: PolicyName, key: string, now = Date.now()): void {
  const r = hit(name, key, now);
  if (!r.ok) throw new HttpError(429, POLICIES[name].message, r.retryAfter);
}

/** Best-effort client address. Vercel overwrites these headers, so they are trustworthy there. */
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || "unknown";
}
