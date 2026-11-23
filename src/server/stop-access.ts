import type { Stop } from "@/lib/types";
import { cleanLine } from "@/lib/text";
import type { LngLat } from "@/lib/types";
import { serializeAccessTrail } from "@/lib/access-trail";
import { spendUserShare } from "@/server/budget";
import { getWalkingTrail } from "@/server/external/mapbox";
import { prisma } from "./db";
import { capTrail, lookupRoadEnd } from "./hike/road-end-lookup";
import { lookupHikeStatus } from "./hike/service";
import { withDeadline } from "./http";
import { toStopDto } from "./mappers";
import { HttpError } from "./http-error";

const MAX_NAME = 120;
/** Overall limit for the lookup: shorter than the browser's 20 s request timeout, so the answer ("not finished, retry later") still arrives. */
export const ACCESS_DEADLINE_MS = 17_000;
const cleanName = (n: string | null): string | null => cleanLine(n, MAX_NAME);

/**
 * Looks up the parking lot (a resolved lot always wins; with none, the road end and trail for an off-road stop) the stop's hike starts from and saves it on the stop (null when it is not the user's).
 * A finished lookup, with or without a lot, sets `accessResolvedAt`; a failed one (service down) writes nothing so it is
 * retried; so is one that is still running at the deadline (nothing is saved then). The write only lands if the stop has not moved since it was read.
 */
type AccessData = {
  accessKind: string | null; accessLat: number | null; accessLng: number | null; accessName: string | null;
  accessWalkMeters: number | null; accessTrail: string | null; accessResolvedAt: Date;
};
const NO_ACCESS = { accessKind: null, accessLat: null, accessLng: null, accessName: null, accessWalkMeters: null, accessTrail: null };
const round10 = (m: number) => Math.round(m / 10) * 10;

/** Concurrent resolutions of the same stop (double tap, two tabs) share one lookup, so one spend and one walking call. */
const inFlight = new Map<string, Promise<AccessData | null>>();

/** What to save, or null when the lookup failed (or has no answer yet) and nothing should be written. Never throws. */
async function compute(userId: string, row: { lat: number; lng: number }): Promise<AccessData | null> {
  try {
    const { hike, failed } = await lookupHikeStatus(row.lat, row.lng);
    if (failed) return null;
    const lot = hike?.access ?? null;
    if (lot && hike) {
      return { ...NO_ACCESS, accessLat: lot.lat, accessLng: lot.lng, accessName: cleanName(lot.name), accessWalkMeters: Math.round(hike.distanceMeters), accessResolvedAt: new Date() };
    }
    const road = await lookupRoadEnd(row.lat, row.lng);
    if (road.failed || !road.result) return null;
    const r = road.result;
    if (r.kind !== "road-end") return { ...NO_ACCESS, accessResolvedAt: new Date() };
    let trail = r.trail;
    let walk = r.walkMeters;
    if (trail === null) {
      // A cached walking answer still costs one user-share unit (the spend happens before getWalkingTrail's cache); accepted, the share is bounded.
      await spendUserShare("mapbox-directions", userId);
      const found = await getWalkingTrail(r.point, [row.lng, row.lat]);
      if (found) {
        trail = capTrail(found.geometry, row);
        walk = found.distanceMeters;
      }
    }
    const accessTrail = serializeAccessTrail(trail as LngLat[] | null);
    return { accessKind: "road-end", accessLat: r.point[1], accessLng: r.point[0], accessName: "Road end", accessWalkMeters: round10(walk), accessTrail, accessResolvedAt: new Date() };
  } catch (e) {
    if (!(e instanceof HttpError)) console.error("stop access lookup failed:", e instanceof Error ? e.message : "unknown error");
    return null;
  }
}

export async function resolveStopAccess(userId: string, stopId: string, deadlineMs = ACCESS_DEADLINE_MS): Promise<Stop | null> {
  const row = await prisma.stop.findFirst({ where: { id: stopId, trip: { userId } } });
  if (!row) return null;
  const key = `${userId}:${stopId}:${row.lat},${row.lng}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = withDeadline(compute(userId, row), deadlineMs, () => null).finally(() => {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    });
    inFlight.set(key, pending);
  }
  const data = await pending;
  if (!data) return toStopDto(row);
  await prisma.stop.updateMany({ where: { id: stopId, trip: { userId }, lat: row.lat, lng: row.lng }, data });
  const fresh = await prisma.stop.findFirst({ where: { id: stopId, trip: { userId } } });
  return fresh ? toStopDto(fresh) : null;
}
