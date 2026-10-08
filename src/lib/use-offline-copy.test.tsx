// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "../../tests/helpers/memory-storage";
import { clearAllCopies, disableOfflineSaving, enableOfflineSaving, listTripCopies, loadTripCopy, saveTripCopy } from "./offline-store";
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
});
