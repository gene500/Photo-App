import { optimizeOrder } from "@/lib/optimize-order";
import { optimizeRequestSchema } from "@/lib/validation";
import { ExternalServiceError, getDurationMatrix } from "@/server/external/mapbox";
import { handle, HttpError, readJson, requireUserId } from "@/server/http";

/** Fastest visiting order for the submitted coordinates; the first one stays the start. */
export const POST = handle(async (req: Request) => {
  await requireUserId();
  const { coordinates } = optimizeRequestSchema.parse(await readJson(req));
  try {
    const durations = await getDurationMatrix(coordinates);
    return Response.json({ order: optimizeOrder(durations) });
  } catch (e) {
    if (e instanceof ExternalServiceError) throw new HttpError(502, e.message);
    throw e;
  }
});
