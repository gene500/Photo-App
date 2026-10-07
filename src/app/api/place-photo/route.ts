import { z } from "zod";
import { pointQuerySchema } from "@/lib/validation";
import { handle, requireUserId } from "@/server/http";
import { getPlacePhoto } from "@/server/external/place-photo";

const querySchema = pointQuerySchema.extend({ name: z.string().trim().min(1).max(200) });

export const GET = handle(async (req: Request) => {
  await requireUserId();
  const params = new URL(req.url).searchParams;
  const place = querySchema.parse({
    lat: params.get("lat") ?? undefined,
    lng: params.get("lng") ?? undefined,
    name: params.get("name") ?? undefined,
  });
  // Photos are decorative: a failed lookup is just "no photo". Browser cache: a day for hits, 15 min for misses.
  const photo = await getPlacePhoto(place);
  return Response.json({ photo }, { headers: { "Cache-Control": `private, max-age=${photo ? 86400 : 900}` } });
});
