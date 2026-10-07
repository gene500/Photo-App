import { z } from "zod";
import { ExternalServiceError, geocode } from "@/server/external/mapbox";
import { handle, HttpError, requireUserId } from "@/server/http";

const querySchema = z.string().trim().min(2, "Type at least 2 characters").max(200);
const proximitySchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, "proximity must be lng,lat")
  .transform((s) => {
    const [lng, lat] = s.split(",").map(Number);
    return { lng, lat };
  })
  .pipe(z.object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }));

export const GET = handle(async (req: Request) => {
  await requireUserId();
  const params = new URL(req.url).searchParams;
  const q = querySchema.parse(params.get("q") ?? "");
  const rawProximity = params.get("proximity");
  const proximity = rawProximity === null ? undefined : proximitySchema.parse(rawProximity);
  try {
    return Response.json({ places: await geocode(q, { proximity }) });
  } catch (e) {
    if (e instanceof ExternalServiceError) throw new HttpError(502, e.message);
    throw e;
  }
});
