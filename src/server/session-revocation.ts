import { prisma } from "./db";
import { TtlCache } from "./suggestions/cache";

/**
 * Per-session sign-out. Tokens are stateless, so signing out only deleted the browser's cookie and a copied cookie kept
 * working until it expired. Each token now carries a random `sid`; signing out records it here until the token's own
 * expiry, and the session callback refuses a recorded `sid`. Other sessions of the same user are untouched (unlike
 * bumping `sessionVersion`, which signs out every device).
 *
 * Storage: rows in the existing `RateLimitCounter` table (key `revoked-session:<sid>`, `resetAt` = token expiry), so no
 * schema change. `sweepSharedLimits` already removes rows past `resetAt`, which is exactly when the token is dead anyway.
 * Tokens issued before `sid` existed have none and cannot be revoked individually; they still end on expiry, password
 * change, "sign out everywhere" or account deletion.
 */

const KEY_PREFIX = "revoked-session:";
const FALLBACK_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const REVOKED_CHECK_TTL_MS = 15_000;

// Same reasoning as the session-version cache: a revoke in a route handler must clear the entry the page side reads.
const g = globalThis as unknown as { __notRevoked?: TtlCache<true>; __revokeEpoch?: { n: number } };
const notRevoked = (g.__notRevoked ??= new TtlCache<true>(REVOKED_CHECK_TTL_MS, 2000));
export const clearRevocationCache = () => notRevoked.clear();
// Bumped by every revoke. A check that started before a revoke must not cache "not revoked" afterwards (its read may predate the row).
const epoch = (g.__revokeEpoch ??= { n: 0 });

/** Records this session id as signed out until `expSeconds` (the token's `exp` claim, epoch seconds). */
export async function revokeSession(sid: string, expSeconds?: number, now = Date.now()): Promise<void> {
  const resetAt = expSeconds ? Math.max(expSeconds * 1000, now + 60_000) : now + FALLBACK_LIFETIME_MS;
  const key = KEY_PREFIX + sid;
  await prisma.rateLimitCounter.upsert({
    where: { key },
    create: { key, count: 1, resetAt },
    update: { count: 1, resetAt },
  });
  epoch.n++;
  notRevoked.delete(sid);
}

export async function isSessionRevoked(sid: string, now = Date.now()): Promise<boolean> {
  if (notRevoked.get(sid)) return false;
  const startedAt = epoch.n;
  const row = await prisma.rateLimitCounter.findUnique({ where: { key: KEY_PREFIX + sid } });
  if (row && Number(row.resetAt) > now) return true;
  if (epoch.n === startedAt) notRevoked.set(sid, true);
  return false;
}
