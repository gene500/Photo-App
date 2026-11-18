import type { Stop } from "@/lib/types";
import { cleanLine } from "@/lib/text";
import { prisma } from "./db";
import { lookupHikeStatus } from "./hike/service";
import { withDeadline } from "./http";
import { toStopDto } from "./mappers";

const MAX_NAME = 120;
/** Overall limit for the lookup: shorter than the browser's 20 s request timeout, so the answer ("not finished, retry later") still arrives. */
export const ACCESS_DEADLINE_MS = 17_000;
const cleanName = (n: string | null): string | null => cleanLine(n, MAX_NAME);

/**
 * Looks up the parking lot the stop's hike starts from and saves it on the stop (null when it is not the user's).
 * A finished lookup, with or without a lot, sets `accessResolvedAt`; a failed one (service down) writes nothing so it is
 * retried; so is one that is still running at the deadline (nothing is saved then). The write only lands if the stop has not moved since it was read.
 */
export async function resolveStopAccess(userId: string, stopId: string, deadlineMs = ACCESS_DEADLINE_MS): Promise<Stop | null> {
  const row = await prisma.stop.findFirst({ where: { id: stopId, trip: { userId } } });
  if (!row) return null;
  const { hike, failed } = await withDeadline(lookupHikeStatus(row.lat, row.lng), deadlineMs, () => ({ hike: null, failed: true }));
  if (failed) return toStopDto(row);
  const lot = hike?.access ?? null;
  await prisma.stop.updateMany({
    where: { id: stopId, trip: { userId }, lat: row.lat, lng: row.lng },
    data: { accessLat: lot?.lat ?? null, accessLng: lot?.lng ?? null, accessName: lot ? cleanName(lot.name) : null, accessWalkMeters: lot && hike ? Math.round(hike.distanceMeters) : null, accessResolvedAt: new Date() },
  });
  const fresh = await prisma.stop.findFirst({ where: { id: stopId, trip: { userId } } });
  return fresh ? toStopDto(fresh) : null;
}
