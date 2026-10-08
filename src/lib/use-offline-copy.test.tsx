// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "../../tests/helpers/memory-storage";
import { listTripCopies, loadTripCopy, saveTripCopy } from "./offline-store";
import type { Stop, Trip } from "./types";
import { useOfflineCopy } from "./use-offline-copy";

const trip: Trip = { id: "t1", name: "Trip", plannedDate: "2026-07-01", departAt: null, shareToken: "TOKEN" };
const stops: Stop[] = [];

beforeEach(() => {
  installMemoryStorage();
  vi.useFakeTimers();
});
afterEach(() => {
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
});
