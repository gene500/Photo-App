import { enforceLimit } from "@/server/rate-limit";
import { directionsRequestSchema } from "@/lib/validation";
import { ExternalServiceError, getDirections } from "@/server/external/mapbox";
import { handle, HttpError, readJson, requireUserId } from "@/server/http";

export const POST = handle(async (req: Request) => {
  const userId = await requireUserId();
  enforceLimit("directions", userId);
  const { coordinates } = directionsRequestSchema.parse(await readJson(req));
  try {
    return Response.json({ route: await getDirections(coordinates) }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (e) {
    if (e instanceof ExternalServiceError) throw new HttpError(502, e.message);
    throw e;
  }
});
