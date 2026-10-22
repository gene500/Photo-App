import { z } from "zod";
import { ExternalServiceError, locateArea } from "@/server/external/mapbox";
import { handle, HttpError, requireUserId } from "@/server/http";
import { enforcePaidLimit } from "@/server/shared-limit";

const querySchema = z.string().trim().min(2, "Type at least 2 characters").max(200, "Search text must be at most 200 characters");

/** Where a trip name points (a city, park region or state), so the map can open there instead of on the world view. */
export const GET = handle(async (req: Request) => {
  await enforcePaidLimit("locate", await requireUserId());
  const q = querySchema.parse(new URL(req.url).searchParams.get("q") ?? "");
  try {
    return Response.json({ area: await locateArea(q) });
  } catch (e) {
    if (e instanceof ExternalServiceError) throw new HttpError(502, e.message);
    throw e;
  }
});
