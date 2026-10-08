// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { installMemoryStorage, type MemoryStorage } from "../../tests/helpers/memory-storage";
import { MAX_COPIES, claimOwner, clearAllCopies, listTripCopies, loadTripCopy, saveTripCopy } from "./offline-store";
import type { Stop, TripWithStops } from "./types";

const stop = (i: number): Stop => ({
  id: `s${i}`, tripId: "t", order: i, name: `Stop ${i}`, lat: 37, lng: -119, notes: "n", source: "manual",
  photoUrl: "/uploads/private.jpg", visited: false, lightPref: "golden", dwellMinutes: 30, shotNotes: "wide", shotChecklist: [{ text: "a", done: true }],
});
const trip = (id: string, over: Partial<TripWithStops> = {}): TripWithStops => ({
  id, name: `Trip ${id}`, plannedDate: "2026-07-01", departAt: null, shareToken: "SECRET-TOKEN", stops: [stop(0), stop(1)], ...over,
});
const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n));

let mem: MemoryStorage;
beforeEach(() => {
  mem = installMemoryStorage();
});

describe("offline-store", () => {
  it("round-trips a trip and lists it", () => {
    expect(saveTripCopy(trip("a"), at(1))).toBe(true);
    const copy = loadTripCopy("a");
    expect(copy?.trip.name).toBe("Trip a");
    expect(copy?.trip.stops).toHaveLength(2);
    expect(copy?.trip.stops[0].shotChecklist).toEqual([{ text: "a", done: true }]);
    expect(copy?.savedAt).toBe(at(1).toISOString());
    expect(listTripCopies()).toEqual([{ id: "a", name: "Trip a", plannedDate: "2026-07-01", savedAt: at(1).toISOString(), stopCount: 2 }]);
  });

  it("never stores the share token or photo URLs", () => {
    saveTripCopy(trip("a"));
    const raw = Array.from({ length: mem.length }, (_, i) => mem.getItem(mem.key(i)!)).join("\n");
    expect(raw).not.toContain("SECRET-TOKEN");
    expect(raw).not.toContain("private.jpg");
    expect(loadTripCopy("a")?.trip.shareToken).toBeNull();
  });

  it("replaces an existing copy and moves it to the front", () => {
    saveTripCopy(trip("a"), at(1));
    saveTripCopy(trip("b"), at(2));
    saveTripCopy(trip("a", { name: "Renamed" }), at(3));
    expect(listTripCopies().map((e) => e.id)).toEqual(["a", "b"]);
    expect(loadTripCopy("a")?.trip.name).toBe("Renamed");
  });

  it("keeps only the 20 most recent trips and removes the evicted data", () => {
    for (let i = 0; i < MAX_COPIES + 3; i++) saveTripCopy(trip(`t${i}`), at(i));
    const ids = listTripCopies().map((e) => e.id);
    expect(ids).toHaveLength(MAX_COPIES);
    expect(ids[0]).toBe(`t${MAX_COPIES + 2}`);
    expect(ids).not.toContain("t0");
    expect(loadTripCopy("t0")).toBeNull();
    expect(localStorage.getItem("rtpp.offline.trip.t0")).toBeNull();
  });

  it("handles a full quota silently by dropping older copies, and gives up quietly when nothing fits", () => {
    saveTripCopy(trip("old"), at(1));
    mem.failWrites = (k) => k === "rtpp.offline.trip.new" && mem.getItem("rtpp.offline.trip.old") !== null;
    expect(saveTripCopy(trip("new"), at(2))).toBe(true);
    expect(loadTripCopy("new")).not.toBeNull();
    expect(loadTripCopy("old")).toBeNull();
    mem.failWrites = () => true;
    expect(() => saveTripCopy(trip("x"), at(3))).not.toThrow();
    expect(saveTripCopy(trip("x"), at(3))).toBe(false);
  });

  it("returns null for corrupt data", () => {
    localStorage.setItem("rtpp.offline.trip.bad", "{not json");
    localStorage.setItem("rtpp.offline.index", "nope");
    expect(loadTripCopy("bad")).toBeNull();
    expect(listTripCopies()).toEqual([]);
  });

  it("clearAllCopies removes every offline key but nothing else", () => {
    saveTripCopy(trip("a"));
    claimOwner("u1");
    localStorage.setItem("other", "keep");
    clearAllCopies();
    expect(listTripCopies()).toEqual([]);
    expect(loadTripCopy("a")).toBeNull();
    expect(mem.length).toBe(1);
  });

  it("claimOwner keeps copies for the same user and wipes them for a different one", () => {
    claimOwner("u1");
    saveTripCopy(trip("a"));
    claimOwner("u1");
    expect(listTripCopies()).toHaveLength(1);
    claimOwner("u2");
    expect(listTripCopies()).toEqual([]);
    expect(localStorage.getItem("rtpp.offline.owner")).toBe("u2");
  });

  it("wipes copies of unknown origin when an owner is first claimed", () => {
    saveTripCopy(trip("a"));
    claimOwner("u1");
    expect(listTripCopies()).toEqual([]);
  });

  it("fills defaults for fields older copies lack", () => {
    saveTripCopy(trip("a"), at(1));
    const raw = JSON.parse(mem.getItem("rtpp.offline.trip.a")!);
    for (const st of raw.trip.stops) { delete st.shotChecklist; delete st.shotNotes; delete st.lightPref; delete st.dwellMinutes; }
    mem.setItem("rtpp.offline.trip.a", JSON.stringify(raw));
    const s0 = loadTripCopy("a")!.trip.stops[0];
    expect(s0.shotChecklist).toEqual([]);
    expect(s0.shotNotes).toBeNull();
    expect(s0.lightPref).toBe("any");
    expect(s0.dwellMinutes).toBe(0);
  });

  it("drops a copy whose stops are malformed, and its index entry", () => {
    saveTripCopy(trip("a"), at(1));
    saveTripCopy(trip("b"), at(2));
    const raw = JSON.parse(mem.getItem("rtpp.offline.trip.a")!);
    raw.trip.stops[1].lat = "north";
    mem.setItem("rtpp.offline.trip.a", JSON.stringify(raw));
    expect(loadTripCopy("a")).toBeNull();
    expect(mem.getItem("rtpp.offline.trip.a")).toBeNull();
    expect(listTripCopies().map((e) => e.id)).toEqual(["b"]);
    mem.setItem("rtpp.offline.trip.b", JSON.stringify({ savedAt: "x", trip: { id: "b", name: "B", plannedDate: "d", stops: [null] } }));
    expect(loadTripCopy("b")).toBeNull();
    expect(listTripCopies()).toEqual([]);
  });

  it("removes an index entry whose payload is missing", () => {
    saveTripCopy(trip("a"), at(1));
    mem.removeItem("rtpp.offline.trip.a");
    expect(loadTripCopy("a")).toBeNull();
    expect(listTripCopies()).toEqual([]);
  });
});
