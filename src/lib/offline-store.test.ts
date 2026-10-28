// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { installMemoryStorage, type MemoryStorage } from "../../tests/helpers/memory-storage";
import { MAX_COPIES, claimOwner, clearAllCopies, disableOfflineSaving, enableOfflineSaving, offlineSavingDisabled, pruneTripCopies, removeTripCopy, listTripCopies, loadTripCopy, saveTripCopy } from "./offline-store";
import type { Stop, TripWithStops } from "./types";

const stop = (i: number): Stop => ({
  id: `s${i}`, tripId: "t", order: i, name: `Stop ${i}`, lat: 37, lng: -119, notes: "n", source: "manual",
  photoUrl: "/uploads/private.jpg", visited: false, lightPref: "golden", priority: "normal", dwellMinutes: 30, shotNotes: "wide", shotChecklist: [{ text: "a", done: true }],
});
const trip = (id: string, over: Partial<TripWithStops> = {}): TripWithStops => ({
  id, name: `Trip ${id}`, plannedDate: "2026-07-01", departAt: null, shareToken: "SECRET-TOKEN", stops: [stop(0), stop(1)], ...over,
});
const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n));

let mem: MemoryStorage;
beforeEach(() => {
  mem = installMemoryStorage();
  mem.setItem("rtpp.offline.owner", "u1"); // a signed-in page has claimed the device
});

describe("offline-store", () => {
  it("removes the trip payload when its index entry cannot be written", () => {
    mem.failWrites = (k) => k === "rtpp.offline.index";
    expect(saveTripCopy(trip("a"), at(1))).toBe(false);
    expect(mem.getItem("rtpp.offline.trip.a")).toBeNull();
  });

  it("drops a copy whose dates are corrupt instead of showing Invalid Date", () => {
    saveTripCopy(trip("a"), at(1));
    const stored = JSON.parse(mem.getItem("rtpp.offline.trip.a")!);
    mem.setItem("rtpp.offline.trip.a", JSON.stringify({ ...stored, trip: { ...stored.trip, plannedDate: "garbage" } }));
    expect(loadTripCopy("a")).toBeNull();
    saveTripCopy(trip("b"), at(2));
    const b = JSON.parse(mem.getItem("rtpp.offline.trip.b")!);
    mem.setItem("rtpp.offline.trip.b", JSON.stringify({ ...b, trip: { ...b.trip, departAt: "zzz" } }));
    expect(loadTripCopy("b")).toBeNull();
  });

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

  it("handles a full quota silently by dropping an older copy, and gives up quietly when storage refuses everything", () => {
    saveTripCopy(trip("old"), at(1));
    mem.quota = mem.used() + 40; // the new copy only fits once "old" is gone
    expect(saveTripCopy(trip("new"), at(2))).toBe(true);
    expect(loadTripCopy("new")).not.toBeNull();
    expect(loadTripCopy("old")).toBeNull();
    mem.failWrites = () => true;
    expect(() => saveTripCopy(trip("x"), at(3))).not.toThrow();
    expect(saveTripCopy(trip("x"), at(3))).toBe(false);
    expect(loadTripCopy("new")).not.toBeNull();
  });

  describe("a full quota", () => {
    const fill = () => {
      for (let i = 0; i < 4; i++) saveTripCopy(trip(`t${i}`), at(i + 1));
      return mem.used();
    };

    it("deletes nothing when the new copy could not fit even after evicting every other copy", () => {
      mem.quota = fill() + 100;
      const removed: string[] = [];
      const remove = mem.removeItem.bind(mem);
      mem.removeItem = (k: string) => { removed.push(k); remove(k); };
      const indexBefore = mem.getItem("rtpp.offline.index");
      expect(saveTripCopy(trip("huge", { name: "x".repeat(mem.used() * 2) }), at(10))).toBe(false);
      expect(removed.filter((k) => /trip\.t\d/.test(k))).toEqual([]);
      expect(mem.getItem("rtpp.offline.index")).toBe(indexBefore);
      for (let i = 0; i < 4; i++) expect(loadTripCopy(`t${i}`)).not.toBeNull();
    });

    it("evicts only as many of the oldest copies as the new one needs, and none of the others", () => {
      mem.quota = fill() + 400; // room for roughly one more byte-for-byte small trip
      expect(saveTripCopy(trip("t4", { name: "y".repeat(150) }), at(10))).toBe(true);
      expect(listTripCopies().map((e) => e.id)).toEqual(["t4", "t3", "t2", "t1"]);
      expect(loadTripCopy("t0")).toBeNull();
      expect(loadTripCopy("t1")).not.toBeNull();
      expect(loadTripCopy("t4")).not.toBeNull();
      for (const e of listTripCopies()) expect(loadTripCopy(e.id)).not.toBeNull();
    });

    it("puts the evicted copies back when the write still fails", () => {
      mem.quota = fill() + 400;
      mem.failWrites = (k) => k === "rtpp.offline.trip.t4";
      expect(saveTripCopy(trip("t4", { name: "y".repeat(150) }), at(10))).toBe(false);
      for (let i = 0; i < 4; i++) expect(loadTripCopy(`t${i}`)).not.toBeNull();
      expect(listTripCopies()).toHaveLength(4);
    });
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
    mem.removeItem("rtpp.offline.owner"); // copies exist but nobody claimed them
    claimOwner("u1");
    expect(listTripCopies()).toEqual([]);
  });

  it("refuses to save when no owner is recorded (signed out in another tab)", () => {
    mem.removeItem("rtpp.offline.owner");
    expect(saveTripCopy(trip("a"))).toBe(false);
    expect(listTripCopies()).toEqual([]);
  });

  it("stops saving in this tab when another tab signs out", () => {
    window.dispatchEvent(new StorageEvent("storage", { key: "rtpp.offline.signedout", newValue: "1" }));
    expect(saveTripCopy(trip("a"))).toBe(false);
    enableOfflineSaving();
    expect(saveTripCopy(trip("a"))).toBe(true);
  });

  it("resumes saving when another tab signs out and back in as the same user, but not as someone else", () => {
    enableOfflineSaving();
    claimOwner("u1");
    window.dispatchEvent(new StorageEvent("storage", { key: "rtpp.offline.signedout", newValue: "1" }));
    expect(saveTripCopy(trip("a"))).toBe(false);
    window.dispatchEvent(new StorageEvent("storage", { key: "rtpp.offline.owner", newValue: "u2" })); // a different user
    expect(offlineSavingDisabled()).toBe(true);
    window.dispatchEvent(new StorageEvent("storage", { key: "rtpp.offline.owner", newValue: "u1" })); // the same user again
    expect(offlineSavingDisabled()).toBe(false);
    mem.setItem("rtpp.offline.owner", "u1");
    expect(saveTripCopy(trip("a"))).toBe(true);
  });

  it("does not resume after this tab itself signed out, even if the same user signs in elsewhere", () => {
    enableOfflineSaving();
    claimOwner("u1");
    disableOfflineSaving();
    window.dispatchEvent(new StorageEvent("storage", { key: "rtpp.offline.owner", newValue: "u1" }));
    expect(offlineSavingDisabled()).toBe(true);
    enableOfflineSaving();
  });

  it("keeps saving here when another tab only clears the copies (owner removed)", () => {
    window.dispatchEvent(new StorageEvent("storage", { key: "rtpp.offline.owner", newValue: null }));
    mem.removeItem("rtpp.offline.owner");
    claimOwner("u1");
    expect(saveTripCopy(trip("a"))).toBe(true);
  });

  it("a save that can never fit leaves the other copies and the index intact", () => {
    for (let i = 0; i < 5; i++) saveTripCopy(trip(`t${i}`), at(i + 1));
    const indexBefore = mem.getItem("rtpp.offline.index");
    mem.failWrites = (k) => k === "rtpp.offline.trip.huge";
    expect(saveTripCopy(trip("huge"), at(10))).toBe(false);
    expect(mem.getItem("rtpp.offline.index")).toBe(indexBefore);
    for (let i = 0; i < 5; i++) expect(loadTripCopy(`t${i}`)).not.toBeNull();
    expect(listTripCopies()).toHaveLength(5);
  });

  it("keeps the index consistent with the payloads after evicting to make room", () => {
    for (let i = 0; i < 3; i++) saveTripCopy(trip(`t${i}`), at(i + 1));
    mem.quota = mem.used() + 40;
    expect(saveTripCopy(trip("big"), at(10))).toBe(true);
    expect(listTripCopies().map((e) => e.id)).toEqual(["big", "t2", "t1"]);
    for (const e of listTripCopies()) expect(loadTripCopy(e.id)).not.toBeNull();
  });

  it("removes one copy, and prunes copies of trips the server no longer has", () => {
    saveTripCopy(trip("a"), at(1));
    saveTripCopy(trip("b"), at(2));
    saveTripCopy(trip("c"), at(3));
    removeTripCopy("a");
    expect(loadTripCopy("a")).toBeNull();
    expect(mem.getItem("rtpp.offline.trip.a")).toBeNull();
    expect(listTripCopies().map((e) => e.id)).toEqual(["c", "b"]);
    pruneTripCopies(["c"]);
    expect(listTripCopies().map((e) => e.id)).toEqual(["c"]);
    expect(mem.getItem("rtpp.offline.trip.b")).toBeNull();
    pruneTripCopies([]);
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

describe("saved suggestion lists", () => {
  it("are cleared with the offline copies and when a trip's copy is removed", async () => {
    const { saveSuggestions, loadSuggestions } = await import("./suggestions-store");
    const { clearAllCopies, removeTripCopy } = await import("./offline-store");
    const list = { key: "[[1,2]]", items: [] };
    saveSuggestions("t1", list);
    saveSuggestions("t2", list);
    removeTripCopy("t1");
    expect(loadSuggestions("t1")).toBeNull();
    expect(loadSuggestions("t2")).not.toBeNull();
    clearAllCopies();
    expect(loadSuggestions("t2")).toBeNull();
  });
});
