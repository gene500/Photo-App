import { z } from "zod";
import { pointQuerySchema } from "@/lib/validation";
import { handle, requireUserId } from "@/server/http";
import { getPlacePhoto } from "@/server/external/wikimedia";

const querySchema = pointQuerySchema.extend({ name: z.string().trim().min(1).max(200) });

export const GET = handle(async (req: Request) => {
  await requireUserId();
  const params = new URL(req.url).searchParams;
  const place = querySchema.parse({
    lat: params.get("lat") ?? undefined,
    lng: params.get("lng") ?? undefined,
    name: params.get("name") ?? undefined,
  });
  // Photos are decorative: a failed lookup is just "no photo". Cached per user's browser for a day.
  const photo = await getPlacePhoto(place);
  return Response.json({ photo }, { headers: { "Cache-Control": "private, max-age=86400" } });
});
