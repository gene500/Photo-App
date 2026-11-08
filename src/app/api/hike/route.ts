import { hikeQuerySchema } from "@/lib/validation";
import { DEADLINE_FAST_MS, handle, requireUserId, withDeadline } from "@/server/http";
import { enforceLimit } from "@/server/rate-limit";
import { getHike } from "@/server/hike/service";

export const GET = handle(async (req: Request) => {
  enforceLimit("hike", await requireUserId());
  const params = new URL(req.url).searchParams;
  const q = hikeQuerySchema.parse({ lat: params.get("lat") ?? undefined, lng: params.get("lng") ?? undefined });
  // Decorative: a failed lookup is just "no hike". Browser cache: an hour for a hike, a minute for none (it may be a
  // failed lookup, which the client retries after a minute).
  const hike = await withDeadline(getHike(q.lat, q.lng), DEADLINE_FAST_MS, () => null);
  return Response.json({ hike }, { headers: { "Cache-Control": `private, max-age=${hike ? 3600 : 60}` } });
});
