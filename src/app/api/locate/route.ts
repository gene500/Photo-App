import { z } from "zod";
import { ExternalServiceError, locateArea, locateLandmark } from "@/server/external/mapbox";
import { handle, HttpError, requireUserId } from "@/server/http";
import { enforcePaidLimit } from "@/server/shared-limit";

const querySchema = z.string().trim().min(2, "Type at least 2 characters").max(200, "Search text must be at most 200 characters");

/** Where a trip name points (a city, park region or state), so the map can open there instead of on the world view, plus the park or landmark it names, if any. */
export const GET = handle(async (req: Request) => {
  const userId = await requireUserId();
  // Validate first so a malformed request never uses up paid-API quota.
  const q = querySchema.parse(new URL(req.url).searchParams.get("q") ?? "");
  await enforcePaidLimit("locate", userId);
  let area: Awaited<ReturnType<typeof locateArea>> = null;
  let areaError: ExternalServiceError | null = null;
  try {
    area = await locateArea(q);
  } catch (e) {
    if (!(e instanceof ExternalServiceError)) throw e;
    areaError = e;
  }
  // A landmark lookup that fails must never fail the request: the map still pans to the area.
  const landmark = await locateLandmark(q).catch(() => null);
  // The area lookup failing only fails the request when the landmark cannot stand in for it.
  if (areaError && !landmark) throw new HttpError(502, areaError.message);
  return Response.json({ area: area ?? (landmark ? { lat: landmark.lat, lng: landmark.lng } : null), landmark });
});
