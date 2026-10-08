import type { Stop } from "@/lib/types";
import type { NewStopInput, StopPatch } from "@/lib/validation";
import { MAX_ROUTE_WAYPOINTS } from "@/lib/validation";
import { prisma } from "./db";
import { toStopDto } from "./mappers";

export class InvalidReorderError extends Error {
  constructor() {
    super("stopIds must list every stop in the trip exactly once");
    this.name = "InvalidReorderError";
  }
}

export class TooManyStopsError extends Error {
  constructor() {
    super(`A trip can have at most ${MAX_ROUTE_WAYPOINTS} stops`);
    this.name = "TooManyStopsError";
  }
}

export type StopUpdate = Omit<StopPatch, "photoUrl"> & { photoUrl?: string | null };

/** Shot notes are stored trimmed; whitespace-only becomes null. */
const cleanShotNotes = (v: string | null): string | null => (v === null || v.trim() === "" ? null : v.trim());

/** The checklist column holds JSON text; shot notes are trimmed; everything else in a patch maps straight to columns. */
function toStopData({ shotChecklist, shotNotes, ...rest }: StopUpdate) {
  return {
    ...rest,
    ...(shotNotes === undefined ? {} : { shotNotes: cleanShotNotes(shotNotes) }),
    ...(shotChecklist === undefined ? {} : { shotChecklist: JSON.stringify(shotChecklist) }),
  };
}

export async function addStop(
  userId: string,
  tripId: string,
  input: NewStopInput,
): Promise<Stop | null> {
  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findFirst({ where: { id: tripId, userId }, select: { id: true } });
    if (!trip) return null;
    if ((await tx.stop.count({ where: { tripId } })) >= MAX_ROUTE_WAYPOINTS) throw new TooManyStopsError();
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
        lightPref: input.lightPref,
        dwellMinutes: input.dwellMinutes,
        shotNotes: cleanShotNotes(input.shotNotes ?? null),
        shotChecklist: JSON.stringify(input.shotChecklist ?? []),
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
  try {
    return toStopDto(await prisma.stop.update({ where: { id: stopId }, data: toStopData(patch) }));
  } catch (e) {
    // Deleted between the ownership check and the update (Prisma "record not found").
    if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2025") return null;
    throw e;
  }
}

export type PhotoSwap =
  | { status: "swapped"; stop: Stop | null } // null: swapped, then the stop was deleted before we re-read it
  | { status: "conflict"; stop: Stop }
  | { status: "gone" };

/**
 * Compare-and-swap of a stop's photoUrl: only updates if it still equals `expected`.
 * "conflict" means another request changed it first (stop = the current state).
 */
export async function swapStopPhoto(
  userId: string,
  stopId: string,
  expected: string | null,
  next: string | null,
): Promise<PhotoSwap> {
  const { count } = await prisma.stop.updateMany({
    where: { id: stopId, trip: { userId }, photoUrl: expected },
    data: { photoUrl: next },
  });
  const current = await getOwnedStop(userId, stopId);
  if (count === 1) return { status: "swapped", stop: current };
  return current ? { status: "conflict", stop: current } : { status: "gone" };
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
