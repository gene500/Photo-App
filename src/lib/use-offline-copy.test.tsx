// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "../../tests/helpers/memory-storage";
import { claimOwner, clearAllCopies, disableOfflineSaving, enableOfflineSaving, listTripCopies, loadTripCopy, saveTripCopy } from "./offline-store";
import type { Stop, Trip } from "./types";
import { useOfflineCopy } from "./use-offline-copy";

const trip: Trip = { id: "t1", name: "Trip", plannedDate: "2026-07-01", departAt: null, shareToken: "TOKEN" };
const stops: Stop[] = [];

beforeEach(() => {
  installMemoryStorage();
  localStorage.setItem("rtpp.offline.owner", "u1"); // a signed-in page has claimed the device
  vi.useFakeTimers();
});
afterEach(() => {
  enableOfflineSaving();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useOfflineCopy", () => {
  it("saves after the debounce, without the share token", () => {
    renderHook(() => useOfflineCopy(trip, stops, "u1"));
    expect(listTripCopies()).toEqual([]);
    vi.advanceTimersByTime(2000);
    expect(loadTripCopy("t1")?.trip.shareToken).toBeNull();
  });

  it("does not save without a user, or while offline", () => {
    renderHook(() => useOfflineCopy(trip, stops, undefined));
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderHook(() => useOfflineCopy(trip, stops, "u1"));
    vi.advanceTimersByTime(2000);
    expect(listTripCopies()).toEqual([]);
  });

  it("retries a save skipped while offline once the connection returns", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderHook(() => useOfflineCopy(trip, stops, "u1"));
    vi.advanceTimersByTime(2000);
    expect(listTripCopies()).toEqual([]);
    onLine.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    vi.advanceTimersByTime(2000);
    expect(loadTripCopy("t1")).not.toBeNull();
  });

  it("wipes another user's copies before saving", () => {
    saveTripCopy({ ...trip, id: "old", stops: [] });
    localStorage.setItem("rtpp.offline.owner", "someone-else");
    renderHook(() => useOfflineCopy(trip, stops, "u1"));
    vi.advanceTimersByTime(2000);
    expect(listTripCopies().map((e) => e.id)).toEqual(["t1"]);
  });

  it("sign-out race: a pending save cannot re-create the copy after the copies were cleared", () => {
    saveTripCopy({ ...trip, stops: [] });
    renderHook(() => useOfflineCopy(trip, stops, "u1"));
    vi.advanceTimersByTime(1000); // the debounce is still pending when Sign out is clicked
    disableOfflineSaving();
    clearAllCopies();
    vi.advanceTimersByTime(5000); // ...and fires while the async signOut is still in flight
    expect(listTripCopies()).toEqual([]);
    expect(localStorage.getItem("rtpp.offline.owner")).toBeNull();
    expect(saveTripCopy({ ...trip, stops: [] })).toBe(false); // direct saves are blocked too
  });

  it("saves again once saving is re-enabled (after a login)", () => {
    disableOfflineSaving();
    enableOfflineSaving();
    renderHook(() => useOfflineCopy(trip, stops, "u1"));
    vi.advanceTimersByTime(2000);
    expect(listTripCopies()).toHaveLength(1);
  });

  it("resumes saving after another tab cleared the copies (owner removed), but not after a sign-out", () => {
    renderHook(() => useOfflineCopy(trip, stops, "u1"));
    localStorage.removeItem("rtpp.offline.owner");
    window.dispatchEvent(new StorageEvent("storage", { key: "rtpp.offline.owner", newValue: null }));
    vi.advanceTimersByTime(2000);
    expect(listTripCopies().map((e) => e.id)).toEqual(["t1"]);
    expect(localStorage.getItem("rtpp.offline.owner")).toBe("u1");
    window.dispatchEvent(new StorageEvent("storage", { key: "rtpp.offline.signedout", newValue: "1" }));
    const t2 = { ...trip, id: "t2" };
    renderHook(() => useOfflineCopy(t2, stops, "u1"));
    vi.advanceTimersByTime(2000);
    expect(listTripCopies().map((e) => e.id)).toEqual(["t1"]);
  });

  describe("verify against the server", () => {
    it("saves only a state the server confirms", async () => {
      const verify = vi.fn().mockResolvedValue("fresh");
      renderHook(() => useOfflineCopy(trip, stops, "u1", 1500, verify));
      await vi.advanceTimersByTimeAsync(2000);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(loadTripCopy("t1")).not.toBeNull();
    });

    it("does not write a state known to be stale or unverifiable, so a stale tab cannot overwrite the copy", async () => {
      saveTripCopy({ ...trip, name: "Server version", stops: [] });
      for (const state of ["stale", "unknown"] as const) {
        const verify = vi.fn().mockResolvedValue(state);
        renderHook(() => useOfflineCopy({ ...trip, name: "Old tab" }, stops, "u1", 1500, verify));
        await vi.advanceTimersByTimeAsync(2000);
        expect(verify).toHaveBeenCalled();
      }
      expect(loadTripCopy("t1")!.trip.name).toBe("Server version");
    });

    it("saves nothing for a trip deleted elsewhere and drops its old copy", async () => {
      saveTripCopy({ ...trip, stops: [] });
      renderHook(() => useOfflineCopy(trip, stops, "u1", 1500, vi.fn().mockResolvedValue("gone")));
      await vi.advanceTimersByTimeAsync(2000);
      expect(listTripCopies()).toEqual([]);
    });

    it("drops a verified save when saving was switched off while the check was running", async () => {
      let release!: (f: "fresh") => void;
      const verify = vi.fn(() => new Promise<"fresh">((r) => { release = r; }));
      renderHook(() => useOfflineCopy(trip, stops, "u1", 1500, verify));
      await vi.advanceTimersByTimeAsync(2000);
      disableOfflineSaving();
      release("fresh");
      await vi.advanceTimersByTimeAsync(10);
      expect(listTripCopies()).toEqual([]);
    });
  });

  it("saves again when the same user signs back in elsewhere after another tab signed out", () => {
    enableOfflineSaving();
    claimOwner("u1");
    renderHook(() => useOfflineCopy(trip, stops, "u1"));
    window.dispatchEvent(new StorageEvent("storage", { key: "rtpp.offline.signedout", newValue: "1" }));
    vi.advanceTimersByTime(2000);
    expect(listTripCopies()).toEqual([]);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "rtpp.offline.owner", newValue: "u1" }));
    });
    vi.advanceTimersByTime(2000);
    expect(listTripCopies().map((e) => e.id)).toEqual(["t1"]);
  });
});
