import { z } from "zod";
import { ExternalServiceError, searchPlaces } from "@/server/external/mapbox";
import { handle, HttpError, requireUserId } from "@/server/http";
import { enforceLimit } from "@/server/rate-limit";

const querySchema = z.string().trim().min(2, "Type at least 2 characters").max(200, "Search text must be at most 200 characters");
const sessionSchema = z.string().uuid("session must be a uuid");
const proximitySchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, "proximity must be lng,lat")
  .transform((s) => {
    const [lng, lat] = s.split(",").map(Number);
    return { lng, lat };
  })
  .pipe(z.object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }));

export const GET = handle(async (req: Request) => {
  enforceLimit("geocode", await requireUserId());
  const params = new URL(req.url).searchParams;
  const q = querySchema.parse(params.get("q") ?? "");
  const sessionToken = sessionSchema.parse(params.get("session") ?? "");
  const rawProximity = params.get("proximity");
  const proximity = rawProximity === null ? undefined : proximitySchema.parse(rawProximity);
  try {
    return Response.json({ suggestions: await searchPlaces(q, { proximity, sessionToken }) });
  } catch (e) {
    if (e instanceof ExternalServiceError) throw new HttpError(502, e.message);
    throw e;
  }
});
