import { z } from "zod";
import { sessionSchema } from "@/lib/validation";
import { ExternalServiceError, searchPlaces } from "@/server/external/mapbox";
import { DEADLINE_FAST_MS, handle, HttpError, requireUserId, withDeadline } from "@/server/http";
import { enforcePaidLimit } from "@/server/shared-limit";

const querySchema = z.string().trim().min(2, "Type at least 2 characters").max(200, "Search text must be at most 200 characters");
const proximitySchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, "proximity must be lng,lat")
  .transform((s) => {
    const [lng, lat] = s.split(",").map(Number);
    return { lng, lat };
  })
  .pipe(z.object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }));

export const GET = handle(async (req: Request) => {
  const userId = await requireUserId();
  const params = new URL(req.url).searchParams;
  const q = querySchema.parse(params.get("q") ?? "");
  const sessionToken = sessionSchema.parse(params.get("session") ?? "");
  const rawProximity = params.get("proximity");
  const proximity = rawProximity === null ? undefined : proximitySchema.parse(rawProximity);
  // Malformed requests are refused before they count against the paid limit.
  await enforcePaidLimit("geocode", userId);
  try {
    const suggestions = await withDeadline(searchPlaces(q, { proximity, sessionToken }), DEADLINE_FAST_MS, () => {
      throw new ExternalServiceError("Couldn't reach the place search service");
    });
    return Response.json({ suggestions });
  } catch (e) {
    if (e instanceof ExternalServiceError) throw new HttpError(502, e.message);
    throw e;
  }
});
