import { timingSafeEqual } from "node:crypto";
import { retryPendingDeletions } from "@/server/photos";
import { sweepSharedLimits } from "@/server/shared-limit";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/**
 * Daily maintenance run by Vercel Cron: retries photo removals that failed earlier and clears expired rate-limit
 * counters. Without CRON_SECRET (or with the wrong one) it answers 404, so it reveals nothing to anyone else.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return new Response(null, { status: 404 });
  const photos = await retryPendingDeletions();
  await sweepSharedLimits();
  return Response.json({ photos }, { headers: { "Cache-Control": "private, no-store" } });
}
