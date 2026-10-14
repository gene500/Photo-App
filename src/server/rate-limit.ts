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
/** One map per policy, so flooding one (say signup from many addresses) cannot push another's counters (login failures) out. */
const maps = new Map<string, Map<string, Bucket>>();
const MAX_BUCKETS = 10_000;
const mapFor = (name: string): Map<string, Bucket> => {
  let m = maps.get(name);
  if (!m) maps.set(name, (m = new Map()));
  return m;
};

const MINUTE = 60_000;

/** name -> allowed hits per window. Keys are scoped by the caller (user id, IP, email). */
export const POLICIES = {
  "signup-ip": { limit: 5, windowMs: 60 * MINUTE, message: "Too many sign-up attempts. Try again later." },
  "signup-email": { limit: 3, windowMs: 60 * MINUTE, message: "Too many sign-up attempts. Try again later." },
  "login-ip": { limit: 30, windowMs: 15 * MINUTE, message: "Too many login attempts. Try again later." },
  /** Counts failed logins only, so an attacker cannot lock a victim out by merely submitting requests that succeed. */
  "login-email-failures": { limit: 8, windowMs: 15 * MINUTE, message: "Too many login attempts. Try again later." },
  geocode: { limit: 60, windowMs: MINUTE, message: "Too many searches. Slow down a little." },
  "reverse-geocode": { limit: 60, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
  "trip-write": { limit: 60, windowMs: MINUTE, message: "Too many changes. Slow down a little." },
  "photo-read": { limit: 300, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
  suggestions: { limit: 30, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
  popularity: { limit: 60, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
  weather: { limit: 60, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
  "weather-batch": { limit: 20, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
  "account-delete": { limit: 5, windowMs: 15 * MINUTE, message: "Too many attempts. Try again later." },
  directions: { limit: 60, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
  optimize: { limit: 10, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
  "photo-upload": { limit: 20, windowMs: 10 * MINUTE, message: "Too many uploads. Try again in a few minutes." },
  "place-photo": { limit: 60, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
} as const;
export type PolicyName = keyof typeof POLICIES;

/** Tests set RATE_LIMIT_DISABLED=1 (never honoured in production). */
function disabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.RATE_LIMIT_DISABLED === "1";
}

function sweep(buckets: Map<string, Bucket>, now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

function slot(name: PolicyName, key: string, now: number): Bucket {
  const buckets = mapFor(name);
  const existing = buckets.get(key);
  if (existing && existing.resetAt > now) return existing;
  sweep(buckets, now);
  const fresh = { count: 0, resetAt: now + POLICIES[name].windowMs };
  // Full of live entries (an attack with many distinct keys): never evict them. The new key is counted for this one
  // request only, so existing keys keep their counters and the map cannot grow without bound.
  if (buckets.size < MAX_BUCKETS) buckets.set(key, fresh);
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
  // Read-only: looking up a key must not create a bucket (an attacker submitting endless emails would fill the map).
  const b = mapFor(name).get(key);
  if (!b || b.resetAt <= now) return { ok: true };
  return b.count >= POLICIES[name].limit ? { ok: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) } : { ok: true };
}

export function resetLimit(name: PolicyName, key: string): void {
  mapFor(name).delete(key);
}

export function clearAllLimits(): void {
  maps.clear();
}

/** Counts a hit and throws a 429 (with Retry-After) when over the limit. */
export function enforceLimit(name: PolicyName, key: string, now = Date.now()): void {
  const r = hit(name, key, now);
  if (!r.ok) throw new HttpError(429, POLICIES[name].message, r.retryAfter);
}

/** Best-effort client address. Vercel overwrites these headers, so they are trustworthy there. */
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return ipKey(real);
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first ? ipKey(first) : "unknown";
}

/** IPv4 as is. IPv6 collapses to its /64, because one customer controls a whole /64 and could otherwise rotate addresses past every per-IP limit. */
export function ipKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  const [head, tail = ""] = ip.split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back] : front;
  if (groups.length !== 8) return ip;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}
