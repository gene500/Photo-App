import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./db";
import { createTrip, getTrip } from "./trips";
import {
  addStop, deleteStop, findStopByPhotoUrl, getOwnedStop, InvalidReorderError, reorderStops, StopsChangedError, updateStop, updateStopCascade,
} from "./stops";
import { createTestUser, resetDb, sampleTripInput } from "../../tests/helpers/db";

const pin = (name: string) => ({ name, lat: 37, lng: -119.5, source: "manual" as const });

async function tripWithStops(names: string[]) {
  const user = await createTestUser();
  const trip = await createTrip(user.id, sampleTripInput);
  const stops = [];
  for (const n of names) stops.push((await addStop(user.id, trip.id, pin(n)))!);
  return { user, trip, stops };
}

describe("stops data access", () => {
  beforeEach(resetDb);

  it("appends stops at the next order position", async () => {
    const { stops } = await tripWithStops(["a", "b", "c"]);
    expect(stops.map((s) => s.order)).toEqual([0, 1, 2]);
    expect(stops[0]).toMatchObject({ name: "a", source: "manual", visited: false, notes: null });
  });

  it("defaults to any light and 30 minutes, and stores and patches both", async () => {
    const { user, trip, stops } = await tripWithStops(["a"]);
    expect(stops[0]).toMatchObject({ lightPref: "any", dwellMinutes: 30 });
    const b = await addStop(user.id, trip.id, { ...pin("b"), lightPref: "sunset", dwellMinutes: 90 });
    expect(b).toMatchObject({ lightPref: "sunset", dwellMinutes: 90 });
    const patched = await updateStop(user.id, stops[0].id, { lightPref: "golden", dwellMinutes: 0 });
    expect(patched).toMatchObject({ lightPref: "golden", dwellMinutes: 0 });
  });

  it("stores shot notes and checklist, defaulting to empty, and round-trips patches", async () => {
    const { user, trip, stops } = await tripWithStops(["a"]);
    expect(stops[0]).toMatchObject({ shotNotes: null, shotChecklist: [] });
    const list = [{ text: "Reflection shot", done: false }, { text: "Long exposure", done: true }];
    const b = await addStop(user.id, trip.id, { ...pin("b"), shotNotes: "Tripod", shotChecklist: list });
    expect(b).toMatchObject({ shotNotes: "Tripod", shotChecklist: list });
    const patched = await updateStop(user.id, stops[0].id, { shotChecklist: list, shotNotes: "ND filter" });
    expect(patched).toMatchObject({ shotNotes: "ND filter", shotChecklist: list });
    expect((await getOwnedStop(user.id, stops[0].id))?.shotChecklist).toEqual(list);
    // Patching other fields leaves the checklist alone; null clears the notes.
    expect(await updateStop(user.id, stops[0].id, { visited: true, shotNotes: null })).toMatchObject({ shotNotes: null, shotChecklist: list });
    expect((await updateStop(user.id, stops[0].id, { shotChecklist: [] }))?.shotChecklist).toEqual([]);
  });

  it("trims shot notes and stores null for whitespace-only", async () => {
    const { user, trip, stops } = await tripWithStops(["a"]);
    expect(await updateStop(user.id, stops[0].id, { shotNotes: "  Tripod \n" })).toMatchObject({ shotNotes: "Tripod" });
    expect(await updateStop(user.id, stops[0].id, { shotNotes: "   \n " })).toMatchObject({ shotNotes: null });
    expect(await addStop(user.id, trip.id, { ...pin("b"), shotNotes: "  " })).toMatchObject({ shotNotes: null });
  });

  it("stores null for whitespace-only notes and leaves other notes as typed", async () => {
    const { user, trip, stops } = await tripWithStops(["a"]);
    expect(await updateStop(user.id, stops[0].id, { notes: "  \n " })).toMatchObject({ notes: null });
    expect(await updateStop(user.id, stops[0].id, { notes: " keep " })).toMatchObject({ notes: " keep " });
    expect(await addStop(user.id, trip.id, { ...pin("b"), notes: "   " })).toMatchObject({ notes: null });
  });

  it("does not let another user patch a stop's shot list", async () => {
    const { stops } = await tripWithStops(["a"]);
    const intruder = await createTestUser();
    expect(await updateStop(intruder.id, stops[0].id, { shotChecklist: [{ text: "x", done: false }] })).toBeNull();
  });

  it("refuses to add a stop to another user's trip", async () => {
    const { trip } = await tripWithStops([]);
    const intruder = await createTestUser();
    expect(await addStop(intruder.id, trip.id, pin("x"))).toBeNull();
  });

  it("updates visited and notes, and refuses non-owners", async () => {
    const { user, stops } = await tripWithStops(["a"]);
    const intruder = await createTestUser();
    const updated = await updateStop(user.id, stops[0].id, { visited: true, notes: "tripod" });
    expect(updated).toMatchObject({ visited: true, notes: "tripod" });
    expect(await updateStop(intruder.id, stops[0].id, { visited: false })).toBeNull();
    expect(await getOwnedStop(intruder.id, stops[0].id)).toBeNull();
  });

  it("deletes a stop, renumbers the rest, and returns its photo URL", async () => {
    const { user, trip, stops } = await tripWithStops(["a", "b", "c"]);
    await updateStop(user.id, stops[0].id, { photoUrl: "/api/uploads/a.png" });
    expect(await deleteStop(user.id, stops[0].id)).toEqual({ photoUrl: "/api/uploads/a.png" });
    const remaining = (await getTrip(user.id, trip.id))!.stops;
    expect(remaining.map((s) => [s.name, s.order])).toEqual([["b", 0], ["c", 1]]);
  });

  it("applies a new order", async () => {
    const { user, trip, stops } = await tripWithStops(["a", "b", "c"]);
    const result = await reorderStops(user.id, trip.id, [stops[2].id, stops[0].id, stops[1].id]);
    expect(result!.map((s) => s.name)).toEqual(["c", "a", "b"]);
    expect(result!.map((s) => s.order)).toEqual([0, 1, 2]);
  });

  it("keeps the visited run first and orders only the unvisited stops", async () => {
    const { user, trip, stops } = await tripWithStops(["a", "b", "c", "d"]);
    await updateStopCascade(user.id, stops[1].id, { visited: true });
    const result = await reorderStops(user.id, trip.id, [stops[3].id, stops[2].id, stops[1].id, stops[0].id]);
    expect(result!.map((s) => s.name)).toEqual(["a", "b", "d", "c"]);
    expect(result!.map((s) => s.visited)).toEqual([true, true, false, false]);
    expect(result!.map((s) => s.order)).toEqual([0, 1, 2, 3]);
  });

  it("rejects reorders that are not a permutation of the trip's stops", async () => {
    const { user, trip, stops } = await tripWithStops(["a", "b"]);
    const ids = stops.map((s) => s.id);
    await expect(reorderStops(user.id, trip.id, [ids[0], ids[0]])).rejects.toBeInstanceOf(InvalidReorderError);
  });

  it("raises StopsChangedError when the list is well-formed but no longer matches the trip's stops", async () => {
    const { user, trip, stops } = await tripWithStops(["a", "b"]);
    const ids = stops.map((s) => s.id);
    await expect(reorderStops(user.id, trip.id, [ids[0]])).rejects.toBeInstanceOf(StopsChangedError);
    await expect(reorderStops(user.id, trip.id, [ids[0], "foreign"])).rejects.toBeInstanceOf(StopsChangedError);
    await expect(reorderStops(user.id, trip.id, [...ids, "extra"])).rejects.toBeInstanceOf(StopsChangedError);
  });

  it("raises StopsChangedError when a stop vanishes mid-reorder", async () => {
    const { user, trip, stops } = await tripWithStops(["a", "b"]);
    const original = prisma.$transaction.bind(prisma) as (...a: unknown[]) => Promise<unknown>;
    const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce((async (...a: unknown[]) => {
      await prisma.stop.delete({ where: { id: stops[1].id } });
      return original(...a);
    }) as never);
    await expect(reorderStops(user.id, trip.id, [stops[1].id, stops[0].id])).rejects.toBeInstanceOf(StopsChangedError);
    spy.mockRestore();
  });

  it("returns null when reordering another user's trip", async () => {
    const { trip, stops } = await tripWithStops(["a"]);
    const intruder = await createTestUser();
    expect(await reorderStops(intruder.id, trip.id, [stops[0].id])).toBeNull();
  });

  it("finds a stop by photo URL only for its owner", async () => {
    const { user, stops } = await tripWithStops(["a"]);
    const intruder = await createTestUser();
    await updateStop(user.id, stops[0].id, { photoUrl: "/api/uploads/p.png" });
    expect((await findStopByPhotoUrl(user.id, "/api/uploads/p.png"))!.id).toBe(stops[0].id);
    expect(await findStopByPhotoUrl(intruder.id, "/api/uploads/p.png")).toBeNull();
  });

  it("moves a stop", async () => {
    const { user, stops } = await tripWithStops(["a"]);
    const moved = await updateStop(user.id, stops[0].id, { lat: 38.25, lng: -118.5 });
    expect(moved).toMatchObject({ lat: 38.25, lng: -118.5, name: "a" });
  });

  describe("visited run rule", () => {
    const flags = async (userId: string, tripId: string) => (await getTrip(userId, tripId))!.stops.map((s) => s.visited);

    it("checking a stop checks every earlier one, in one update", async () => {
      const { user, trip, stops } = await tripWithStops(["a", "b", "c", "d"]);
      const res = await updateStopCascade(user.id, stops[2].id, { visited: true });
      expect(res!.stop.visited).toBe(true);
      expect(res!.cascaded.map((s) => s.name)).toEqual(["a", "b"]);
      expect(await flags(user.id, trip.id)).toEqual([true, true, true, false]);
    });

    it("unchecking a stop unchecks every later one", async () => {
      const { user, trip, stops } = await tripWithStops(["a", "b", "c", "d"]);
      await updateStopCascade(user.id, stops[3].id, { visited: true });
      const res = await updateStopCascade(user.id, stops[1].id, { visited: false });
      expect(res!.cascaded.map((s) => s.name)).toEqual(["c", "d"]);
      expect(await flags(user.id, trip.id)).toEqual([true, false, false, false]);
    });

    it("a stale client cannot leave a gap: unchecking from a view that shows less still clears every later stop", async () => {
      const { user, trip, stops } = await tripWithStops(["a", "b", "c", "d", "e"]);
      await updateStop(user.id, stops[2].id, { visited: true }); // another tab: a b c visited
      await updateStop(user.id, stops[4].id, { visited: true }); // this tab checks e: everything before it follows
      await updateStop(user.id, stops[0].id, { visited: false }); // the stale tab unchecks only a (it saw nothing else)
      expect(await flags(user.id, trip.id)).toEqual([false, false, false, false, false]);
    });

    it("applies a swap-style patch (visited:false with other fields) through the same rule", async () => {
      const { user, trip, stops } = await tripWithStops(["a", "b", "c"]);
      await updateStop(user.id, stops[2].id, { visited: true });
      const res = await updateStopCascade(user.id, stops[1].id, { name: "b2", visited: false });
      expect(res!.stop).toMatchObject({ name: "b2", visited: false });
      expect(await flags(user.id, trip.id)).toEqual([true, false, false]);
    });

    it("does not touch other trips or report anything when nothing else changes", async () => {
      const { user, trip, stops } = await tripWithStops(["a", "b"]);
      const other = await tripWithStops(["x", "y"]);
      const res = await updateStopCascade(user.id, stops[0].id, { visited: true });
      expect(res!.cascaded).toEqual([]);
      await updateStopCascade(other.user.id, other.stops[1].id, { visited: true });
      expect(await flags(user.id, trip.id)).toEqual([true, false]);
    });

    it("refuses a stop of another user and leaves the run alone", async () => {
      const { user, trip, stops } = await tripWithStops(["a", "b"]);
      const intruder = await createTestUser();
      expect(await updateStopCascade(intruder.id, stops[1].id, { visited: true })).toBeNull();
      expect(await flags(user.id, trip.id)).toEqual([false, false]);
    });
  });
});
