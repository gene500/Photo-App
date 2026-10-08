import { beforeEach, describe, expect, it } from "vitest";
import { createTrip, getTrip } from "./trips";
import {
  addStop, deleteStop, findStopByPhotoUrl, getOwnedStop, InvalidReorderError, reorderStops, updateStop,
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

  it("rejects reorders that are not a permutation of the trip's stops", async () => {
    const { user, trip, stops } = await tripWithStops(["a", "b"]);
    const ids = stops.map((s) => s.id);
    await expect(reorderStops(user.id, trip.id, [ids[0]])).rejects.toBeInstanceOf(InvalidReorderError);
    await expect(reorderStops(user.id, trip.id, [ids[0], ids[0]])).rejects.toBeInstanceOf(InvalidReorderError);
    await expect(reorderStops(user.id, trip.id, [ids[0], "foreign"])).rejects.toBeInstanceOf(InvalidReorderError);
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
});
