import { timingSafeEqual } from "node:crypto";
import { retryPendingDeletions } from "@/server/photos";
import { sweepSharedLimits } from "@/server/shared-limit";
import { SUGGESTION_CACHE_TTL_MS, SUGGESTION_STALE_GRACE_MS } from "@/server/suggestions/service";
import { sweepSuggestionCache } from "@/server/suggestions/shared-cache";

let warnedNoSecret = false;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Otherwise the route just answers 404 and nobody learns the daily cleanup is not running. Warn once per server process.
    if (process.env.NODE_ENV === "production" && !warnedNoSecret) {
      warnedNoSecret = true;
      console.warn("photo-cleanup cron: CRON_SECRET is not set, so the daily cleanup is refused (404). Set it to enable cleanup.");
    }
    return false;
  }
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/**
 * Daily maintenance run by Vercel Cron: retries photo removals that failed earlier, clears expired rate-limit
 * counters and drops suggestion results too old to serve. Without CRON_SECRET (or with the wrong one) it answers 404,
 * so it reveals nothing to anyone else.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return new Response(null, { status: 404 });
  try {
    const photos = await retryPendingDeletions();
    await sweepSharedLimits();
    await sweepSuggestionCache(SUGGESTION_CACHE_TTL_MS + SUGGESTION_STALE_GRACE_MS);
    return Response.json({ photos }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    // Log only the error name: a database message can carry query text or photo URLs.
    console.error("photo-cleanup cron failed:", e instanceof Error ? e.name : "unknown error");
    return Response.json({ error: "Cleanup failed" }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
