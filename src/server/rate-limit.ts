import { HttpError } from "./http-error";

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
  /** Counts failed logins only, keyed by email plus hashed client address, so one address's failures never lock the real owner out from another. */
  "login-email-failures": { limit: 8, windowMs: 15 * MINUTE, message: "Too many login attempts. Try again later." },
  /** Failed logins for an email from all addresses. Once over, only addresses that already failed are refused; a clean one still gets in. */
  "login-email-global": { limit: 50, windowMs: 60 * MINUTE, message: "Too many login attempts. Try again later." },
  geocode: { limit: 60, windowMs: MINUTE, message: "Too many searches. Slow down a little." },
  "geocode-retrieve": { limit: 60, windowMs: MINUTE, message: "Too many searches. Slow down a little." },
  "reverse-geocode": { limit: 60, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
  "trip-write": { limit: 60, windowMs: MINUTE, message: "Too many changes. Slow down a little." },
  "photo-read": { limit: 300, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
  suggestions: { limit: 30, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
  popularity: { limit: 10, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
  /** App-wide Flickr API calls (all users, key "all"); past it popularity falls back to Commons and place photos skip Flickr. */
  "flickr-app": { limit: 3000, windowMs: 60 * MINUTE, message: "Flickr budget spent." },
  weather: { limit: 60, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
  "weather-batch": { limit: 20, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
  "password-change": { limit: 5, windowMs: 15 * MINUTE, message: "Too many attempts. Try again later." },
  "account-delete": { limit: 5, windowMs: 15 * MINUTE, message: "Too many attempts. Try again later." },
  /** Route lookups made by anonymous visitors of one owner's share links, across all of them. */
  "share-directions": { limit: 120, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
  /** Renders of the public /s/[token] page, per client address (enforced in src/proxy.ts). Generous: only stops a flood. */
  "share-view": { limit: 300, windowMs: MINUTE, message: "Too many requests. Slow down a little." },
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

/** Auth-sensitive policies fail closed when their map is full of live keys; the rest fail open. */
const FAIL_CLOSED: ReadonlySet<PolicyName> = new Set<PolicyName>([
  "login-email-failures",
  "login-ip",
  "signup-ip",
  "signup-email",
  "account-delete",
]);

/** True when a new key cannot be tracked because a fail-closed policy's map is full of live keys. */
function untrackable(name: PolicyName, key: string, now: number): boolean {
  if (!FAIL_CLOSED.has(name)) return false;
  const buckets = mapFor(name);
  const existing = buckets.get(key);
  if (existing && existing.resetAt > now) return false;
  sweep(buckets, now);
  return buckets.size >= MAX_BUCKETS;
}

const fullMapResult = (name: PolicyName): LimitResult => ({ ok: false, retryAfter: Math.ceil(POLICIES[name].windowMs / 1000) });

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
  if (untrackable(name, key, now)) return fullMapResult(name);
  const b = slot(name, key, now);
  b.count++;
  return result(name, b, now);
}

/** Whether the next hit would be allowed, without counting it. */
export function isBlocked(name: PolicyName, key: string, now = Date.now()): LimitResult {
  if (disabled()) return { ok: true };
  // Read-only: looking up a key must not create a bucket (an attacker submitting endless emails would fill the map).
  const b = mapFor(name).get(key);
  if (!b || b.resetAt <= now) return untrackable(name, key, now) ? fullMapResult(name) : { ok: true };
  return b.count >= POLICIES[name].limit ? { ok: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) } : { ok: true };
}

/** Hits counted in the current window, without counting one. */
export function peek(name: PolicyName, key: string, now = Date.now()): number {
  const b = mapFor(name).get(key);
  return b && b.resetAt > now ? b.count : 0;
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

/**
 * Client address for per-IP limits. Client-supplied headers are only believed where a trusted proxy sets them:
 * - on Vercel (VERCEL is set): x-vercel-forwarded-for, else the LAST x-forwarded-for entry (the one Vercel appends);
 * - elsewhere only with TRUST_PROXY_HEADERS=1: the x-forwarded-for entry TRUSTED_PROXY_DEPTH (default 1) from the right;
 * - otherwise every address header is ignored and all clients share one key (limits then apply to everyone together).
 * x-real-ip and the first x-forwarded-for entry are never used: a client can write both.
 */
export function clientIp(headers: Headers): string {
  const entries = () => (headers.get("x-forwarded-for") ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  let raw: string | undefined;
  if (process.env.VERCEL) {
    raw = headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || entries().at(-1);
  } else if (process.env.TRUST_PROXY_HEADERS === "1") {
    const depth = Math.max(1, Math.floor(Number(process.env.TRUSTED_PROXY_DEPTH)) || 1);
    const list = entries();
    raw = list.length >= depth ? list[list.length - depth] : undefined;
  }
  if (!raw && !warnedNoProxy() && process.env.NODE_ENV === "production" && !process.env.VERCEL && process.env.TRUST_PROXY_HEADERS !== "1") {
    markWarnedNoProxy();
    console.warn("[rate-limit] No trusted proxy configured: every client shares one address key. Set TRUST_PROXY_HEADERS=1 (and TRUSTED_PROXY_DEPTH) when running behind a proxy.");
  }
  return raw ? ipKey(raw) : "unknown";
}

// The proxy and the route handlers are separate bundles that each load this module, so the flag lives on globalThis.
const WARNED_KEY = "__rtppWarnedNoProxy";
const warnedNoProxy = (): boolean => (globalThis as Record<string, unknown>)[WARNED_KEY] === true;
const markWarnedNoProxy = (): void => {
  (globalThis as Record<string, unknown>)[WARNED_KEY] = true;
};

/** IPv4 as is. IPv6 collapses to its /64, because one customer controls a whole /64 and could otherwise rotate addresses past every per-IP limit. */
export function ipKey(raw: string): string {
  const ip = raw.split("%")[0]!; // drop a zone id (fe80::1%eth0)
  if (!ip.includes(":")) return ip;
  let text = ip;
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const prefix = dotted[1]!;
    const o = dotted.slice(2).map(Number);
    if (o.some((n) => n > 255)) return ip;
    if (/^(::ffff:|64:ff9b::)$/i.test(prefix)) return o.join(".");
    text = `${prefix}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const [head, tail = ""] = text.split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const groups = text.includes("::") ? [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back] : front;
  if (groups.length !== 8) return ip;
  // IPv4-mapped / NAT64 in hex form: key on the embedded IPv4 address.
  const n = groups.map((g) => parseInt(g, 16));
  const embedded = `${n[6]! >> 8}.${n[6]! & 255}.${n[7]! >> 8}.${n[7]! & 255}`;
  if (n.slice(0, 5).every((x) => x === 0) && n[5] === 0xffff) return embedded;
  if (n[0] === 0x64 && n[1] === 0xff9b && n.slice(2, 6).every((x) => x === 0)) return embedded;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}
