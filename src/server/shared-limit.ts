import { createHash } from "node:crypto";
import { prisma } from "./db";
import { HttpError } from "./http";
import { hit, isBlocked, POLICIES, resetLimit, type LimitResult, type PolicyName } from "./rate-limit";

/**
 * Rate limits for the auth-sensitive policies, counted in the database so they hold across serverless instances
 * (the in-memory limiter alone gives each warm instance its own counters). The in-memory limiter still runs first as
 * a free fast path; the database is the source of truth. If the database is unreachable the in-memory result stands,
 * so a database outage never locks everyone out of logging in.
 */

const disabled = () => process.env.NODE_ENV !== "production" && process.env.RATE_LIMIT_DISABLED === "1";
/** A key that is safe to store: short keys as they are, anything over 254 characters as its sha256 hex. */
export const limitKey = (key: string) => (key.length > 254 ? createHash("sha256").update(key).digest("hex") : key);
const rowKey = (name: PolicyName, key: string) => `${name}:${key}`;
const fail = (retryAfterMs: number): LimitResult => ({ ok: false, retryAfter: Math.max(1, Math.ceil(retryAfterMs / 1000)) });

/** Counts one hit in the shared store and reports whether it is still within the limit. */
export async function hitShared(name: PolicyName, key: string, now = Date.now()): Promise<LimitResult> {
  if (disabled()) return { ok: true };
  const local = hit(name, key, now);
  if (!local.ok) return local;
  const { limit, windowMs } = POLICIES[name];
  if (Math.random() < 0.01) void sweepSharedLimits(now);
  try {
    // One statement, so concurrent requests cannot both read the same count: it starts a fresh window when the old one
    // has ended, and otherwise adds one.
    const rows = await prisma.$queryRaw<{ count: number; resetAt: bigint | number }[]>`
      INSERT INTO "RateLimitCounter" ("key", "count", "resetAt") VALUES (${rowKey(name, key)}, 1, ${now + windowMs})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "resetAt" <= ${now} THEN 1 ELSE "count" + 1 END,
        "resetAt" = CASE WHEN "resetAt" <= ${now} THEN ${now + windowMs} ELSE "resetAt" END
      RETURNING "count", "resetAt"`;
    const row = rows[0];
    if (row && Number(row.count) > limit) return fail(Number(row.resetAt) - now);
  } catch {
    // Database unavailable: fall back to the in-memory answer above.
  }
  return { ok: true };
}

/** Whether the next hit would be refused, without counting it. */
export async function isBlockedShared(name: PolicyName, key: string, now = Date.now()): Promise<LimitResult> {
  if (disabled()) return { ok: true };
  const local = isBlocked(name, key, now);
  if (!local.ok) return local;
  try {
    const row = await prisma.rateLimitCounter.findUnique({ where: { key: rowKey(name, key) } });
    if (row && Number(row.resetAt) > now && row.count >= POLICIES[name].limit) return fail(Number(row.resetAt) - now);
  } catch {
    // Database unavailable: keep the in-memory answer.
  }
  return { ok: true };
}

export async function resetShared(name: PolicyName, key: string): Promise<void> {
  resetLimit(name, key);
  if (disabled()) return;
  try {
    await prisma.rateLimitCounter.deleteMany({ where: { key: rowKey(name, key) } });
  } catch {
    // Best effort.
  }
}

/** Like `enforceLimit`, but shared across instances. Throws a 429 when over the limit. */
export async function enforceSharedLimit(name: PolicyName, key: string, now = Date.now()): Promise<void> {
  const r = await hitShared(name, key, now);
  if (!r.ok) {
    throw new HttpError(429, POLICIES[name].message, r.retryAfter);
  }
}

/** Removes expired counters. Called opportunistically; the table stays small because rows only exist for active keys. */
export async function sweepSharedLimits(now = Date.now()): Promise<void> {
  try {
    await prisma.rateLimitCounter.deleteMany({ where: { resetAt: { lte: now } } });
  } catch {
    // Best effort.
  }
}
