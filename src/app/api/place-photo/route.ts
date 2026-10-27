import { enforcePaidLimit } from "@/server/shared-limit";
import { z } from "zod";
import { pointQuerySchema } from "@/lib/validation";
import { handle, requireUserId } from "@/server/http";
import { getPlacePhoto } from "@/server/external/place-photo";

const querySchema = pointQuerySchema.extend({ name: z.string().trim().min(1).max(200) });

export const GET = handle(async (req: Request) => {
  const userId = await requireUserId();
  const params = new URL(req.url).searchParams;
  const place = querySchema.parse({
    lat: params.get("lat") ?? undefined,
    lng: params.get("lng") ?? undefined,
    name: params.get("name") ?? undefined,
  });
  // Malformed requests are refused before they count against the paid limit.
  await enforcePaidLimit("place-photo", userId);
  // Photos are decorative: a failed lookup is just "no photo". Browser cache: a day for hits, 15 min for misses.
  const photo = await getPlacePhoto(place);
  return Response.json({ photo }, { headers: { "Cache-Control": photo ? "private, max-age=86400, stale-while-revalidate=604800" : "private, max-age=900" } });
});
