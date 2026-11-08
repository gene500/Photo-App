import { z } from "zod";
import { ExternalServiceError, locateArea, locateLandmark } from "@/server/external/mapbox";
import { DEADLINE_FAST_MS, handle, HttpError, requireUserId, withDeadline } from "@/server/http";
import { enforcePaidLimit } from "@/server/shared-limit";

const querySchema = z.string().trim().min(2, "Type at least 2 characters").max(200, "Search text must be at most 200 characters");

/** Where a trip name points (a city, park region or state), so the map can open there instead of on the world view, plus the park or landmark it names, if any. */
export const GET = handle(async (req: Request) => {
  const userId = await requireUserId();
  // Validate first so a malformed request never uses up paid-API quota.
  const q = querySchema.parse(new URL(req.url).searchParams.get("q") ?? "");
  await enforcePaidLimit("locate", userId);
  // Both lookups run under one deadline so their separate timeouts never add up past the client's limit.
  // Whatever finished by then is used; a lookup still hanging counts as failed.
  let areaRes: { area: Awaited<ReturnType<typeof locateArea>>; areaError: ExternalServiceError | null } | undefined;
  let landmark = null as Awaited<ReturnType<typeof locateLandmark>>;
  const areaWork = locateArea(q).then(
    (a) => { areaRes = { area: a, areaError: null }; },
    (e) => {
      if (!(e instanceof ExternalServiceError)) throw e;
      areaRes = { area: null, areaError: e };
    },
  );
  // A landmark lookup that fails must never fail the request: the map still pans to the area.
  const landmarkWork = locateLandmark(q).then((l) => { landmark = l; }, () => undefined);
  await withDeadline(Promise.all([areaWork, landmarkWork]), DEADLINE_FAST_MS, () => [undefined, undefined] as [void, void]);
  const { area, areaError } = areaRes ?? { area: null, areaError: new ExternalServiceError("Couldn't reach the place search service") };
  // The area lookup failing only fails the request when the landmark cannot stand in for it.
  if (areaError && !landmark) throw new HttpError(502, areaError.message);
  return Response.json({ area: area ?? (landmark ? { lat: landmark.lat, lng: landmark.lng } : null), landmark });
});
