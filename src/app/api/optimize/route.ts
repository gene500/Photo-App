import { enforcePaidLimit } from "@/server/shared-limit";
import { clampToSolarDay, daylightInterval, departureTime } from "@/lib/best-time";
import { optimizeScheduleAsync } from "@/lib/optimize-schedule";
import { optimizeRequestSchema } from "@/lib/validation";
import { ExternalServiceError, getDurationMatrix } from "@/server/external/mapbox";
import { optimizeBudgetMs, withOptimizeSlot } from "@/server/optimize-slots";
import { handle, HttpError, readJson, requireUserId } from "@/server/http";

/**
 * Best visiting order for the submitted coordinates; the first one stays the start.
 * With per-stop light preferences it also picks the departure time (`departAt`) and
 * lists the stops whose light cannot be met (`misses`, by submitted index) and the ones visited in the dark (`dark`).
 */
export const POST = handle(async (req: Request) => {
  const userId = await requireUserId();
  // The concurrency slot comes first: a busy 503 must neither call Mapbox nor use up the user's per-minute allowance.
  return withOptimizeSlot(async () => {
    await enforcePaidLimit("optimize", userId);
    const { coordinates, stops: prefs, plannedDate, departAt, focus, fixDeparture } = optimizeRequestSchema.parse(await readJson(req));
    try {
      const durations = await getDurationMatrix(coordinates);
      const date = plannedDate ?? new Date().toISOString().slice(0, 10);
      const stops = coordinates.map(([lng, lat], i) => ({
        lat,
        lng,
        // A stop with no sunrise or sunset that day has no light to chase, so it must not make the start time move.
        lightPref: daylightInterval(lat, lng, date) ? (prefs?.[i]?.lightPref ?? ("any" as const)) : ("any" as const),
        dwellMinutes: prefs?.[i]?.dwellMinutes ?? 30,
        priority: prefs?.[i]?.priority ?? ("normal" as const),
      }));
      // Yields to other requests while it works, and stops at a time budget.
      const result = await optimizeScheduleAsync(
        {
          durations,
          stops,
          plannedDate: date,
          defaultDeparture: departureTime(stops[0]!, date),
          preferredDeparture: departAt ? new Date(departAt) : undefined,
          focus,
          fixedDeparture: fixDeparture,
        },
        { budgetMs: optimizeBudgetMs() },
      );
      // A kept start time stays as saved; a new one is floored to the minute, as the Start time field shows it (sunrise has seconds).
      const keptSaved = departAt !== undefined && result.departAt.getTime() === new Date(departAt).getTime();
      const departMs = keptSaved ? result.departAt.getTime() : Math.floor(result.departAt.getTime() / 60_000) * 60_000;
      // The trip refuses a start time that is not on its planned (solar) day, so the answer never leaves it (checked at the first stop of the new order).
      const answerDepartAt = result.timed ? clampToSolarDay(new Date(departMs), date, stops[result.order[0] ?? 0]!.lng).toISOString() : null;
      return Response.json({
        order: result.order,
        complete: result.complete !== false,
        departAt: answerDepartAt,
        misses: result.misses
          .map((m) => ({ stopIndex: m.stopIndex, minutes: Math.round(m.minutes), priority: m.priority }))
          .filter((m) => m.minutes > 0),
        dark: result.dark
          .map((m) => ({ stopIndex: m.stopIndex, minutes: Math.round(m.minutes), priority: m.priority }))
          .filter((m) => m.minutes > 0),
        // Stops where the sun does not rise and set on that date: no daylight rule applies to them.
        polar: stops.flatMap((s, i) => (daylightInterval(s.lat, s.lng, date) ? [] : [i])),
      });
    } catch (e) {
      if (e instanceof ExternalServiceError) throw new HttpError(502, e.message);
      throw e;
    }
  });
});
