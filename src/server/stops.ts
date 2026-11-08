import { pinVisitedFirst } from "@/lib/visited-run";
import type { ShotItem, Stop } from "@/lib/types";
import type { NewStopInput, StopPatch } from "@/lib/validation";
import { MAX_ROUTE_WAYPOINTS, MAX_SHOT_ITEMS } from "@/lib/validation";
import { prisma } from "./db";
import { parseShotChecklist, toStopDto } from "./mappers";

export class InvalidReorderError extends Error {
  constructor() {
    super("stopIds must list every stop in the trip exactly once");
    this.name = "InvalidReorderError";
  }
}

export class StopsChangedError extends Error {
  constructor() {
    super("The trip's stops changed; reload and try again");
    this.name = "StopsChangedError";
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

/** Notes keep their text as typed; whitespace-only becomes null. */
const cleanNotes = (v: string | null): string | null => (v === null || v.trim() === "" ? null : v);

/** The checklist column holds JSON text; shot notes are trimmed; everything else in a patch maps straight to columns. */
function toStopData({ shotChecklist, shotNotes, notes, ...rest }: StopUpdate) {
  return {
    ...rest,
    ...(notes === undefined ? {} : { notes: cleanNotes(notes) }),
    ...(shotNotes === undefined ? {} : { shotNotes: cleanShotNotes(shotNotes) }),
    ...(shotChecklist === undefined ? {} : { shotChecklist: JSON.stringify(shotChecklist) }),
  };
}

/**
 * Three-way merge of the shot list by shot text, for a save made from a stale copy: `base` is what the editor started from,
 * `incoming` what it now sends, `stored` what is in the database. A tick the editor did not touch takes the stored value
 * (so another tab's ticks are not undone), a shot added elsewhere is kept, a shot the editor removed stays removed.
 */
export function mergeShotChecklist(stored: ShotItem[], base: ShotItem[], incoming: ShotItem[]): ShotItem[] {
  const done = (list: ShotItem[]) => new Map(list.map((i) => [i.text, i.done] as const).reverse());
  const baseDone = done(base);
  const storedDone = done(stored);
  const merged = incoming.map((i) => {
    const b = baseDone.get(i.text);
    const s = storedDone.get(i.text);
    return b !== undefined && s !== undefined && i.done === b && s !== b ? { text: i.text, done: s } : i;
  });
  const known = new Set([...baseDone.keys(), ...incoming.map((i) => i.text)]);
  for (const s of stored) if (!known.has(s.text)) merged.push(s);
  return merged.slice(0, MAX_SHOT_ITEMS);
}

export async function addStop(
  userId: string,
  tripId: string,
  input: NewStopInput,
): Promise<Stop | null> {
  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findFirst({ where: { id: tripId, userId }, select: { id: true } });
    if (!trip) return null;
    const agg = await tx.stop.aggregate({ where: { tripId }, _count: { _all: true }, _max: { order: true } });
    if (agg._count._all >= MAX_ROUTE_WAYPOINTS) throw new TooManyStopsError();
    const row = await tx.stop.create({
      data: {
        tripId,
        order: (agg._max.order ?? -1) + 1,
        name: input.name,
        lat: input.lat,
        lng: input.lng,
        source: input.source,
        notes: cleanNotes(input.notes ?? null),
        lightPref: input.lightPref,
        priority: input.priority,
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

export type StopUpdateResult = { stop: Stop; /** Other stops whose visited flag changed to keep the checks one run from the start. */ cascaded: Stop[] };

/**
 * Updates a stop. Visited stops always form one run from the start of the trip, so a visited change is applied
 * together with its cascade in one transaction (checking a stop checks every earlier one, unchecking it unchecks
 * every later one). Enforced here so a stale tab cannot leave a gap.
 */
export async function updateStopCascade(
  userId: string,
  stopId: string,
  patch: StopUpdate,
  /** The checklist the editor started from; see mergeShotChecklist. */
  shotBase?: ShotItem[],
): Promise<StopUpdateResult | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.stop.findFirst({ where: { id: stopId, trip: { userId } } });
      if (!row) return null;
      const data = toStopData(shotBase && patch.shotChecklist ? { ...patch, shotChecklist: mergeShotChecklist(parseShotChecklist(row.shotChecklist), shotBase, patch.shotChecklist) } : patch);
      const updated = await tx.stop.update({ where: { id: stopId }, data });
      const cascaded: Stop[] = [];
      if (patch.visited !== undefined) {
        const visited = patch.visited;
        const others = await tx.stop.findMany({
          where: visited
            ? { tripId: row.tripId, order: { lt: updated.order }, visited: false }
            : { tripId: row.tripId, order: { gt: updated.order }, visited: true },
          orderBy: { order: "asc" },
        });
        if (others.length > 0) {
          await tx.stop.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { visited } });
          for (const o of others) cascaded.push(toStopDto({ ...o, visited }));
        }
      }
      return { stop: toStopDto(updated), cascaded };
    });
  } catch (e) {
    // Deleted between the ownership check and the update (Prisma "record not found").
    if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2025") return null;
    throw e;
  }
}

export async function updateStop(userId: string, stopId: string, patch: StopUpdate): Promise<Stop | null> {
  return (await updateStopCascade(userId, stopId, patch))?.stop ?? null;
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
      select: { id: true, order: true },
    });
    for (const [order, s] of remaining.entries()) {
      if (s.order !== order) await tx.stop.update({ where: { id: s.id }, data: { order } });
    }
    return { photoUrl: row.photoUrl };
  });
}

export async function reorderStops(
  userId: string,
  tripId: string,
  stopIds: string[],
): Promise<Stop[] | null> {
  // The read and the writes share one transaction, so a stop deleted (and the rest renumbered) at the same moment cannot
  // leave two stops with the same order.
  try {
    return await prisma.$transaction(async (tx) => {
      const trip = await tx.trip.findFirst({
        where: { id: tripId, userId },
        include: { stops: { select: { id: true, visited: true, order: true }, orderBy: { order: "asc" } } },
      });
      if (!trip) return null;
      const existing = new Set(trip.stops.map((s) => s.id));
      const given = new Set(stopIds);
      if (given.size !== stopIds.length) throw new InvalidReorderError();
      // Well-formed but not this trip's stops any more: one was added or deleted elsewhere.
      if (given.size !== existing.size || stopIds.some((id) => !existing.has(id))) throw new StopsChangedError();
      // Visited stops are behind the owner: they stay first, in their current order; the request only orders the rest.
      const finalIds = pinVisitedFirst(trip.stops, stopIds);
      const was = new Map(trip.stops.map((s) => [s.id, s.order]));
      for (const [order, id] of finalIds.entries()) {
        if (was.get(id) !== order) await tx.stop.update({ where: { id }, data: { order } });
      }
      const rows = await tx.stop.findMany({ where: { tripId }, orderBy: { order: "asc" } });
      return rows.map(toStopDto);
    }, { timeout: 20_000, maxWait: 5_000 }); // the default 5 s is too short for a trip with hundreds of stops on a remote database
  } catch (e) {
    if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2025") throw new StopsChangedError();
    throw e;
  }
}

export async function findStopByPhotoUrl(userId: string, photoUrl: string): Promise<Stop | null> {
  const row = await prisma.stop.findFirst({ where: { photoUrl, trip: { userId } } });
  return row ? toStopDto(row) : null;
}
