import { dateOnlyToUtc } from "@/lib/dates";
import type { Trip, TripSummary, TripWithStops } from "@/lib/types";
import type { TripInput, TripPatch } from "@/lib/validation";
import { prisma } from "./db";
import { toStopDto, toTripDto } from "./mappers";

function patchData(patch: TripPatch) {
  return {
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.plannedDate && { plannedDate: dateOnlyToUtc(patch.plannedDate) }),
  };
}

export async function createTrip(userId: string, input: TripInput): Promise<Trip> {
  const row = await prisma.trip.create({
    data: {
      userId,
      name: input.name,
      plannedDate: dateOnlyToUtc(input.plannedDate),
    },
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
  const { count } = await prisma.trip.updateMany({
    where: { id: tripId, userId },
    data: patchData(patch),
  });
  if (count === 0) return null;
  return toTripDto(await prisma.trip.findUniqueOrThrow({ where: { id: tripId } }));
}

export async function deleteTrip(
  userId: string,
  tripId: string,
): Promise<{ photoUrls: string[] } | null> {
  const row = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    include: { stops: { select: { photoUrl: true } } },
  });
  if (!row) return null;
  await prisma.trip.delete({ where: { id: tripId } });
  return {
    photoUrls: row.stops.map((s) => s.photoUrl).filter((u): u is string => u !== null),
  };
}
