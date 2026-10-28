// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Hike } from "./hike";

const subscribe = vi.fn();
vi.mock("./hike-cache", () => ({ subscribeHike: (...a: unknown[]) => subscribe(...a) }));
import { useHike, useHikes } from "./use-hike";

const HIKE: Hike = { distanceMeters: 1930, geometry: [[-119.52, 36.99], [-119.5, 37]], source: "osm", attribution: "x" };
const release = vi.fn();
beforeEach(() => {
  subscribe.mockReset();
  release.mockReset();
  subscribe.mockImplementation(() => ({ promise: Promise.resolve(HIKE), release }));
});

describe("useHikes", () => {
  it("requests nothing for an empty list", () => {
    const { result } = renderHook(() => useHikes([]));
    expect(subscribe).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });

  it("gives the hike by id once loaded, one subscription per place", async () => {
    const { result } = renderHook(() => useHikes([{ id: "a", lat: 37, lng: -119.5 }, { id: "b", lat: 38, lng: -119 }]));
    await waitFor(() => expect(result.current.get("a")).toEqual(HIKE));
    expect(result.current.get("b")).toEqual(HIKE);
    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it("leaves a place out when it has no hike or the lookup failed", async () => {
    subscribe.mockImplementation((lat: number) => ({ promise: Promise.resolve(lat === 37 ? HIKE : null), release }));
    const { result } = renderHook(() => useHikes([{ id: "a", lat: 37, lng: -119.5 }, { id: "b", lat: 38, lng: -119 }]));
    await waitFor(() => expect(result.current.has("a")).toBe(true));
    expect(result.current.has("b")).toBe(false);
  });

  it("does not re-subscribe when re-rendered with equal points, and releases on unmount", async () => {
    const { result, rerender, unmount } = renderHook(() => useHikes([{ id: "a", lat: 37, lng: -119.5 }]));
    await waitFor(() => expect(result.current.size).toBe(1));
    rerender();
    expect(subscribe).toHaveBeenCalledTimes(1);
    unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("drops the hike when the place moves to somewhere that has none", async () => {
    let pt = { id: "a", lat: 37, lng: -119.5 };
    subscribe.mockImplementation((lat: number) => ({ promise: Promise.resolve(lat === 37 ? HIKE : null), release }));
    const { result, rerender } = renderHook(() => useHikes([pt]));
    await waitFor(() => expect(result.current.size).toBe(1));
    pt = { id: "a", lat: 40, lng: -100 };
    rerender();
    expect(result.current.size).toBe(0);
  });
});

describe("useHike", () => {
  it("is null while loading, then the hike; nothing is requested when disabled", async () => {
    const { result } = renderHook(() => useHike("a", 37, -119.5));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual(HIKE));
    subscribe.mockClear();
    const off = renderHook(() => useHike("a", 37, -119.5, false));
    expect(off.result.current).toBeNull();
    expect(subscribe).not.toHaveBeenCalled();
  });
});
