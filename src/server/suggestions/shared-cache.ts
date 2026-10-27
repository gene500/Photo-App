import type { Suggestion } from "@/lib/types";
import { prisma } from "../db";

/**
 * Suggestion results kept in the database, so a search one serverless instance already paid for (Overpass, popularity
 * lookups) is free for every other instance. The in-memory cache stays in front; this is only read on its miss. Every
 * failure is swallowed: the shared store only ever saves work, it never fails a search.
 */
export type SharedKind = "enriched" | "raw";
export type SharedHit = { value: Suggestion[]; createdAt: number };

/** Off in tests, which share one database and must not see each other's results (the cache's own tests switch it on). */
export const sharedCacheDisabled = () => process.env.SUGGESTION_SHARED_CACHE_DISABLED === "1";

/** A slow database must not slow every cache miss: past this the read counts as a miss. */
export const SHARED_READ_TIMEOUT_MS = 800;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("shared cache read timed out")), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Entries of both kinds for a key that are younger than `maxAgeMs`. */
export async function sharedGet(key: string, maxAgeMs: number, now = Date.now()): Promise<Partial<Record<SharedKind, SharedHit>>> {
  if (sharedCacheDisabled()) return {};
  try {
    const rows = await withTimeout(
      prisma.$queryRaw<{ kind: string; data: string; createdAt: bigint | number }[]>`
        SELECT "kind", "data", "createdAt" FROM "SuggestionCache" WHERE "key" = ${key} AND "createdAt" > ${now - maxAgeMs}`,
      SHARED_READ_TIMEOUT_MS,
    );
    const found: Partial<Record<SharedKind, SharedHit>> = {};
    for (const r of rows) {
      if (r.kind !== "enriched" && r.kind !== "raw") continue;
      const value: unknown = JSON.parse(r.data);
      if (Array.isArray(value)) found[r.kind] = { value: value as Suggestion[], createdAt: Number(r.createdAt) };
    }
    return found;
  } catch {
    return {};
  }
}

/** Rows older than this are never served (service.ts: TTL plus stale grace); pruned opportunistically on writes, not only by the daily cron. */
export const SHARED_PRUNE_AGE_MS = 6.5 * 3_600_000;
const PRUNE_CHANCE = 0.02;

export async function sharedPut(key: string, kind: SharedKind, value: Suggestion[], now = Date.now()): Promise<void> {
  if (sharedCacheDisabled()) return;
  try {
    await prisma.$executeRaw`
      INSERT INTO "SuggestionCache" ("key", "kind", "data", "createdAt") VALUES (${key}, ${kind}, ${JSON.stringify(value)}, ${now})
      ON CONFLICT ("key", "kind") DO UPDATE SET "data" = excluded."data", "createdAt" = excluded."createdAt"`;
  } catch {
    // The next search just builds the result again.
  }
  // User-chosen keys can add thousands of rows a day; do not wait for the daily cron to remove the stale ones.
  if (Math.random() < PRUNE_CHANCE) void sweepSuggestionCache(SHARED_PRUNE_AGE_MS, now);
}

/** Removes entries too old to be served; run daily by the cron route. Returns how many went. */
export async function sweepSuggestionCache(olderThanMs: number, now = Date.now()): Promise<number> {
  try {
    return await prisma.$executeRaw`DELETE FROM "SuggestionCache" WHERE "createdAt" <= ${now - olderThanMs}`;
  } catch {
    return 0;
  }
}
