import { dateOnlyToUtc } from "@/lib/dates";
import type { Trip, TripSummary, TripWithStops } from "@/lib/types";
import type { TripCreateInput, TripPatch } from "@/lib/validation";
import { prisma } from "./db";
import { toStopDto, toTripDto } from "./mappers";

const DAY_MS = 86_400_000;

/** The same time of day on the new date: a start time moves with the trip's day instead of resetting. */
function shiftedDeparture(departAt: Date | null, from: Date, to: Date): Date | null {
  if (!departAt) return null;
  return new Date(departAt.getTime() + Math.round((to.getTime() - from.getTime()) / DAY_MS) * DAY_MS);
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
  let shiftedDepartAt: Date | null | undefined;
  if (patch.plannedDate) {
    const current = await prisma.trip.findFirst({ where: { id: tripId, userId }, select: { plannedDate: true, departAt: true } });
    const next = dateOnlyToUtc(patch.plannedDate);
    if (!current) shiftedDepartAt = null;
    else if (current.plannedDate.getTime() !== next.getTime()) shiftedDepartAt = shiftedDeparture(current.departAt, current.plannedDate, next);
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
