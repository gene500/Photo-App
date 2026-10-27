import { pointQuerySchema } from "@/lib/validation";
import { ExternalServiceError, reverseGeocode } from "@/server/external/mapbox";
import { handle, HttpError, requireUserId } from "@/server/http";
import { enforcePaidLimit } from "@/server/shared-limit";

export const GET = handle(async (req: Request) => {
  const userId = await requireUserId();
  const params = new URL(req.url).searchParams;
  const point = pointQuerySchema.parse({ lat: params.get("lat") ?? undefined, lng: params.get("lng") ?? undefined });
  // Malformed requests are refused before they count against the paid limit.
  await enforcePaidLimit("reverse-geocode", userId);
  try {
    return Response.json({ place: await reverseGeocode(point) });
  } catch (e) {
    if (e instanceof ExternalServiceError) throw new HttpError(502, e.message);
    throw e;
  }
});
