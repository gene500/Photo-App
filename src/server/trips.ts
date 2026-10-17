import { solarDateAt } from "@/lib/best-time";
import { dateOnlyToUtc, shiftDepartAtLocal, utcToDateOnly } from "@/lib/dates";
import type { Trip, TripSummary, TripWithStops } from "@/lib/types";
import { inYearRange, type TripCreateInput, type TripPatch } from "@/lib/validation";
import { prisma } from "./db";
import { toStopDto, toTripDto } from "./mappers";

const HOUR_MS = 3_600_000;

/** The start time sent for a trip's day does not fall on that day. */
export class DepartAtMismatchError extends Error {
  constructor(plannedDate: string) {
    super(`Start time must be on the planned day (${plannedDate}) at the trip's first stop`);
    this.name = "DepartAtMismatchError";
  }
}

/**
 * A start time belongs to the trip's day: the solar day at the first stop's longitude (as the editor picks it). With no
 * stop yet there is no longitude, so any instant that is that day somewhere on Earth (UTC-12 to UTC+12 solar time) passes.
 */
function assertOnPlannedDay(departAt: Date, plannedDate: string, firstLng: number | null): void {
  const t = departAt.getTime();
  const day = dateOnlyToUtc(plannedDate).getTime();
  const ok = firstLng === null ? t >= day - 12 * HOUR_MS && t < day + 36 * HOUR_MS : solarDateAt(departAt, firstLng) === plannedDate;
  if (!ok) throw new DepartAtMismatchError(plannedDate);
}

/** The same clock time on the new date (read in the server's zone, as the editor reads it in the viewer's): a start time moves with the trip's day. */
function shiftedDeparture(departAt: Date | null, from: Date, to: Date): Date | null {
  if (!departAt) return null;
  const shifted = new Date(shiftDepartAtLocal(departAt.toISOString(), utcToDateOnly(from), utcToDateOnly(to)));
  // A start time pushed outside the years the API accepts is dropped (the editor then starts at "now").
  return inYearRange(shifted.getTime()) ? shifted : null;
}

function patchData(patch: TripPatch, shiftedDepartAt: Date | null | undefined) {
  return {
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.plannedDate && { plannedDate: dateOnlyToUtc(patch.plannedDate) }),
    // Changing the date moves a saved start time to the same time of day on the new date.
    ...(shiftedDepartAt !== undefined && patch.departAt === undefined && { departAt: shiftedDepartAt }),
    ...(patch.departAt !== undefined && { departAt: patch.departAt === null ? null : new Date(patch.departAt) }),
  };
}

export const MAX_TRIPS_PER_USER = 100;

export class TooManyTripsError extends Error {
  constructor() {
    super(`You can have at most ${MAX_TRIPS_PER_USER} trips. Delete one to add another.`);
    this.name = "TooManyTripsError";
  }
}

export async function createTrip(userId: string, input: TripCreateInput): Promise<Trip> {
  if (input.departAt) assertOnPlannedDay(new Date(input.departAt), input.plannedDate, null);
  // Count and create together, so parallel requests cannot slip past the cap.
  const row = await prisma.$transaction(async (tx) => {
    if ((await tx.trip.count({ where: { userId } })) >= MAX_TRIPS_PER_USER) throw new TooManyTripsError();
    return tx.trip.create({
      data: {
        userId,
        name: input.name,
        plannedDate: dateOnlyToUtc(input.plannedDate),
        ...(input.departAt && { departAt: new Date(input.departAt) }),
      },
    });
  });
  return toTripDto(row);
}

export async function listTrips(userId: string): Promise<TripSummary[]> {
  const rows = await prisma.trip.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { stops: true } } },
  });
  return rows.map((row) => ({
    ...toTripDto(row),
    stopCount: row._count.stops,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function getTrip(userId: string, tripId: string): Promise<TripWithStops | null> {
  const row = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    include: { stops: { orderBy: { order: "asc" } } },
  });
  if (!row) return null;
  return { ...toTripDto(row), stops: row.stops.map(toStopDto) };
}

export async function updateTrip(
  userId: string,
  tripId: string,
  patch: TripPatch,
): Promise<Trip | null> {
  // Only a different day moves the start time: saving the same date again (a rename) must keep it.
  // An existing start time that no longer matches its day is never checked here: only a different one sent now is.
  let shiftedDepartAt: Date | null | undefined;
  if (patch.plannedDate || patch.departAt) {
    const current = await prisma.trip.findFirst({
      where: { id: tripId, userId },
      select: { plannedDate: true, departAt: true, stops: { orderBy: { order: "asc" }, take: 1, select: { lng: true } } },
    });
    if (!current) return null;
    // Re-sending the stored value (Undo of an old row) is not a change, so it is not checked.
    if (patch.departAt && current.departAt?.getTime() !== new Date(patch.departAt).getTime()) assertOnPlannedDay(new Date(patch.departAt), patch.plannedDate ?? utcToDateOnly(current.plannedDate), current.stops[0]?.lng ?? null);
    if (patch.plannedDate) {
      const next = dateOnlyToUtc(patch.plannedDate);
      if (current.plannedDate.getTime() !== next.getTime()) shiftedDepartAt = shiftedDeparture(current.departAt, current.plannedDate, next);
    }
  }
  const { count } = await prisma.trip.updateMany({
    where: { id: tripId, userId },
    data: patchData(patch, shiftedDepartAt),
  });
  if (count === 0) return null;
  return toTripDto(await prisma.trip.findUniqueOrThrow({ where: { id: tripId } }));
}

export async function deleteTrip(
  userId: string,
  tripId: string,
): Promise<{ photoUrls: string[] } | null> {
  // One transaction, so a photo attached between the read and the delete cannot be left behind.
  const row = await prisma.$transaction(async (tx) => {
    const found = await tx.trip.findFirst({
      where: { id: tripId, userId },
      include: { stops: { select: { photoUrl: true } } },
    });
    if (found) await tx.trip.delete({ where: { id: tripId } });
    return found;
  });
  if (!row) return null;
  return {
    photoUrls: row.stops.map((s) => s.photoUrl).filter((u): u is string => u !== null),
  };
}
