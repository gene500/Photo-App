import { enforcePaidLimit } from "@/server/shared-limit";
import { clampToSolarDay, daylightInterval, departureTime } from "@/lib/best-time";
import { orderWithoutOrigin, stopIndexWithoutOrigin, withOrigin } from "@/lib/optimize-origin";
import { optimizeScheduleAsync } from "@/lib/optimize-schedule";
import { optimizeRequestSchema } from "@/lib/validation";
import { collectPlaceNotices } from "@/server/external/place-notices";
import type { LngLat } from "@/lib/types";
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
  const { body, noticeArgs } = await withOptimizeSlot(async () => {
    await enforcePaidLimit("optimize", userId);
    const input = optimizeRequestSchema.parse(await readJson(req));
    const { coordinates, stops: prefs, plannedDate, departAt, focus, fixDeparture } = input;
    try {
      // The origin only ever helps: if the road network has no route from it to the chosen first stop, optimize without it.
      return (await compute(input.origin)) ?? (await compute(undefined))!;
    } catch (e) {
      if (e instanceof ExternalServiceError) throw new HttpError(502, e.message);
      throw e;
    }
    async function compute(origin: { lat: number; lng: number } | undefined) {
      // With the owner's position, it is index 0 of the same Matrix call (one more waypoint, one call, same cost in kind),
      // so the search chooses the first stop by origin -> first + the rest. It is never logged, and the matrix is not cached.
      const searchCoords = origin ? withOrigin(coordinates, origin) : coordinates;
      const durations = await getDurationMatrix(searchCoords, undefined, { noCache: !!origin });
      const date = plannedDate ?? new Date().toISOString().slice(0, 10);
      const shift = origin ? 1 : 0;
      const stops = searchCoords.map(([lng, lat], k) => {
        // The origin (search index 0) is only a place to drive from: no light rule, no time spent.
        if (origin && k === 0) return { lat, lng, lightPref: "any" as const, dwellMinutes: 0, priority: "normal" as const };
        const i = k - shift;
        return {
          lat,
          lng,
          // A stop with no sunrise or sunset that day has no light to chase, so it must not make the start time move.
          lightPref: daylightInterval(lat, lng, date) ? (prefs?.[i]?.lightPref ?? ("any" as const)) : ("any" as const),
          dwellMinutes: prefs?.[i]?.dwellMinutes ?? 30,
          priority: prefs?.[i]?.priority ?? ("normal" as const),
        };
      });
      // Yields to other requests while it works, and stops at a time budget.
      const result = await optimizeScheduleAsync(
        {
          durations,
          stops,
          plannedDate: date,
          defaultDeparture: departureTime(stops[0]!, date),
          // The saved start is the time at the first stop, which is not known until the order is: with an origin it is not a tie-break.
          preferredDeparture: departAt && !origin ? new Date(departAt) : undefined,
          focus,
          fixedDeparture: fixDeparture,
        },
        { budgetMs: optimizeBudgetMs() },
      );
      // A kept start time stays as saved; a new one is floored to the minute, as the Start time field shows it (sunrise has seconds).
      const keptSaved = departAt !== undefined && result.departAt.getTime() === new Date(departAt).getTime();
      let departMs = keptSaved ? result.departAt.getTime() : Math.floor(result.departAt.getTime() / 60_000) * 60_000;
      // The search departs from the origin; the trip's start time is the time at its first stop, one drive later.
      const order = origin ? orderWithoutOrigin(result.order) : result.order;
      // Drive seconds from the origin to the first stop; Infinity when the road network has no route (Mapbox null).
      const firstLeg = origin && result.order[1] !== undefined ? durations[0]![result.order[1]] : undefined;
      if (origin && firstLeg !== undefined && !Number.isFinite(firstLeg)) return null;
      if (origin && result.timed && firstLeg !== undefined) {
        departMs = Math.floor((result.departAt.getTime() + firstLeg * 1000) / 60_000) * 60_000;
      }
      const reindex = <T extends { stopIndex: number }>(rows: T[]) =>
        rows.flatMap((m) => {
          const k = origin ? stopIndexWithoutOrigin(m.stopIndex) : m.stopIndex;
          return k === null ? [] : [{ ...m, stopIndex: k }];
        });
      const first = stops[(origin ? (order[0] ?? 0) + 1 : (order[0] ?? 0))]!;
      // The trip refuses a start time that is not on its planned (solar) day, so the answer never leaves it (checked at the first stop of the new order).
      const answerDepartAt = result.timed ? clampToSolarDay(new Date(departMs), date, first.lng).toISOString() : null;
      // Estimated start of the search path: the new departure when it was chosen, else the saved start (which the client keeps;
      // with an origin that is the time at the first stop, so the drive from the origin comes before it).
      const savedMs = departAt ? new Date(departAt).getTime() : undefined;
      const noticeStartMs =
        result.timed || savedMs === undefined ? result.departAt.getTime() : savedMs - (origin && Number.isFinite(firstLeg) ? (firstLeg ?? 0) * 1000 : 0);
      const body = {
        order,
        complete: result.complete !== false,
        departAt: answerDepartAt,
        misses: reindex(result.misses)
          .map((m) => ({ stopIndex: m.stopIndex, minutes: Math.round(m.minutes), priority: m.priority }))
          .filter((m) => m.minutes > 0),
        dark: reindex(result.dark)
          .map((m) => ({ stopIndex: m.stopIndex, minutes: Math.round(m.minutes), priority: m.priority }))
          .filter((m) => m.minutes > 0),
        // Stops where the sun does not rise and set on that date: no daylight rule applies to them.
        polar: stops.flatMap((s, i) => (i < shift || daylightInterval(s.lat, s.lng, date) ? [] : [i - shift])),
      };
      return { body, noticeArgs: { searchOrder: result.order, coords: searchCoords, durations, stops, startMs: noticeStartMs, date, shift } };
    }
  });
  // Heads-ups from free public data (NPS alerts, OSM opening hours): fetched after the optimize slot is released, never blocks or fails the optimization.
  const a = noticeArgs;
  const notices = await placeNoticesFor(a.searchOrder, a.coords, a.durations, a.stops, a.startMs, a.date, a.shift);
  return Response.json({ ...body, ...(notices.length ? { notices } : {}) });
});

/** Estimated arrival at each submitted stop in the chosen order (search order, so an origin is index 0), then the notices for them. */
async function placeNoticesFor(
  searchOrder: number[],
  coords: LngLat[],
  durations: number[][],
  stops: { dwellMinutes: number }[],
  startMs: number,
  date: string,
  shift: number,
) {
  try {
    const arrival = new Map<number, number>();
    let t = startMs;
    searchOrder.forEach((k, n) => {
      if (n > 0) t += (durations[searchOrder[n - 1]!]?.[k] ?? 0) * 1000;
      arrival.set(k, t);
      t += (stops[k]?.dwellMinutes ?? 0) * 60_000;
    });
    const points = coords.slice(shift).map(([lng, lat], i) => ({ lat, lng, arrivalMs: arrival.get(i + shift) }));
    return await collectPlaceNotices(points, date);
  } catch {
    return [];
  }
}
