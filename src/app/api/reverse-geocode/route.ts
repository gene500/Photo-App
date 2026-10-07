import { z } from "zod";
import { ExternalServiceError, reverseGeocode } from "@/server/external/mapbox";
import { handle, HttpError, requireUserId } from "@/server/http";

const pointSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export const GET = handle(async (req: Request) => {
  await requireUserId();
  const params = new URL(req.url).searchParams;
  const point = pointSchema.parse({ lat: params.get("lat") ?? undefined, lng: params.get("lng") ?? undefined });
  try {
    return Response.json({ place: await reverseGeocode(point) });
  } catch (e) {
    if (e instanceof ExternalServiceError) throw new HttpError(502, e.message);
    throw e;
  }
});
