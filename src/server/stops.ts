import type { Stop } from "@/lib/types";
import type { NewStopInput, StopPatch } from "@/lib/validation";
import { prisma } from "./db";
import { toStopDto } from "./mappers";

export class InvalidReorderError extends Error {
  constructor() {
    super("stopIds must list every stop in the trip exactly once");
    this.name = "InvalidReorderError";
  }
}

export type StopUpdate = StopPatch & { photoUrl?: string | null };

export async function addStop(
  userId: string,
  tripId: string,
  input: NewStopInput,
): Promise<Stop | null> {
  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findFirst({ where: { id: tripId, userId }, select: { id: true } });
    if (!trip) return null;
    const agg = await tx.stop.aggregate({ where: { tripId }, _max: { order: true } });
    const row = await tx.stop.create({
      data: {
        tripId,
        order: (agg._max.order ?? -1) + 1,
        name: input.name,
        lat: input.lat,
        lng: input.lng,
        source: input.source,
        notes: input.notes ?? null,
      },
    });
    return toStopDto(row);
  });
}

export async function getOwnedStop(userId: string, stopId: string): Promise<Stop | null> {
  const row = await prisma.stop.findFirst({ where: { id: stopId, trip: { userId } } });
  return row ? toStopDto(row) : null;
}

export async function updateStop(
  userId: string,
  stopId: string,
  patch: StopUpdate,
): Promise<Stop | null> {
  if (!(await getOwnedStop(userId, stopId))) return null;
  const row = await prisma.stop.update({ where: { id: stopId }, data: patch });
  return toStopDto(row);
}

export async function deleteStop(
  userId: string,
  stopId: string,
): Promise<{ photoUrl: string | null } | null> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.stop.findFirst({ where: { id: stopId, trip: { userId } } });
    if (!row) return null;
    await tx.stop.delete({ where: { id: stopId } });
    const remaining = await tx.stop.findMany({
      where: { tripId: row.tripId },
      orderBy: { order: "asc" },
      select: { id: true },
    });
    for (const [order, s] of remaining.entries()) {
      await tx.stop.update({ where: { id: s.id }, data: { order } });
    }
    return { photoUrl: row.photoUrl };
  });
}

export async function reorderStops(
  userId: string,
  tripId: string,
  stopIds: string[],
): Promise<Stop[] | null> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    include: { stops: { select: { id: true } } },
  });
  if (!trip) return null;
  const existing = new Set(trip.stops.map((s) => s.id));
  const given = new Set(stopIds);
  if (
    given.size !== stopIds.length ||
    given.size !== existing.size ||
    stopIds.some((id) => !existing.has(id))
  ) {
    throw new InvalidReorderError();
  }
  await prisma.$transaction(
    stopIds.map((id, order) => prisma.stop.update({ where: { id }, data: { order } })),
  );
  const rows = await prisma.stop.findMany({ where: { tripId }, orderBy: { order: "asc" } });
  return rows.map(toStopDto);
}

export async function findStopByPhotoUrl(userId: string, photoUrl: string): Promise<Stop | null> {
  const row = await prisma.stop.findFirst({ where: { photoUrl, trip: { userId } } });
  return row ? toStopDto(row) : null;
}
