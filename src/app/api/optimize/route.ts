import { enforceLimit } from "@/server/rate-limit";
import { departureTime } from "@/lib/best-time";
import { optimizeSchedule } from "@/lib/optimize-schedule";
import { optimizeRequestSchema } from "@/lib/validation";
import { ExternalServiceError, getDurationMatrix } from "@/server/external/mapbox";
import { handle, HttpError, readJson, requireUserId } from "@/server/http";

/**
 * Best visiting order for the submitted coordinates; the first one stays the start.
 * With per-stop light preferences it also picks the departure time (`departAt`) and
 * lists the stops whose light cannot be met (`misses`, by submitted index).
 */
export const POST = handle(async (req: Request) => {
  const userId = await requireUserId();
  enforceLimit("optimize", userId);
  const { coordinates, stops: prefs, plannedDate } = optimizeRequestSchema.parse(await readJson(req));
  try {
    const durations = await getDurationMatrix(coordinates);
    const date = plannedDate ?? new Date().toISOString().slice(0, 10);
    const stops = coordinates.map(([lng, lat], i) => ({
      lat,
      lng,
      lightPref: prefs?.[i]?.lightPref ?? ("any" as const),
      dwellMinutes: prefs?.[i]?.dwellMinutes ?? 30,
    }));
    const usesLight = stops.some((s) => s.lightPref !== "any");
    const result = optimizeSchedule({
      durations,
      stops,
      plannedDate: date,
      defaultDeparture: departureTime(stops[0]!, date),
    });
    return Response.json({
      order: result.order,
      departAt: usesLight ? result.departAt.toISOString() : null,
      misses: result.misses
        .map((m) => ({ stopIndex: m.stopIndex, minutes: Math.round(m.minutes) }))
        .filter((m) => m.minutes > 0),
    });
  } catch (e) {
    if (e instanceof ExternalServiceError) throw new HttpError(502, e.message);
    throw e;
  }
});
