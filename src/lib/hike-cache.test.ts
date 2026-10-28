// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hike } from "./hike";

const hikeApi = vi.fn();
vi.mock("./api-client", () => ({ api: { hike: (...a: unknown[]) => hikeApi(...a) } }));
import { HIKE_FAILURE_TTL_MS, HIKE_MAX_IN_FLIGHT, HIKE_NONE_TTL_MS, HIKE_SUCCESS_TTL_MS, hikeCacheSize, resetHikeCache, subscribeHike } from "./hike-cache";

const HIKE: Hike = { distanceMeters: 1930, geometry: [[-119.52, 36.99], [-119.5, 37]], source: "osm", attribution: "x" };

beforeEach(() => {
  resetHikeCache();
  hikeApi.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("subscribeHike", () => {
  it("resolves to the hike and shares one request per ~11 m cell", async () => {
    hikeApi.mockResolvedValue({ hike: HIKE });
    const a = subscribeHike(37, -119.5);
    const b = subscribeHike(37.00001, -119.5);
    expect(await a.promise).toEqual(HIKE);
    expect(await b.promise).toEqual(HIKE);
    expect(hikeApi).toHaveBeenCalledTimes(1);
  });

  it("is null when there is no hike or the request fails, and never throws", async () => {
    hikeApi.mockResolvedValueOnce({ hike: null }).mockRejectedValueOnce(new Error("x"));
    expect(await subscribeHike(1, 1).promise).toBeNull();
    expect(await subscribeHike(2, 2).promise).toBeNull();
  });

  it("remembers a hike 30 min, none 10 min, a failure 1 min", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    hikeApi.mockResolvedValue({ hike: HIKE });
    await subscribeHike(1, 1).promise;
    vi.setSystemTime(Date.now() + HIKE_SUCCESS_TTL_MS - 1000);
    await subscribeHike(1, 1).promise;
    expect(hikeApi).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 2000);
    await subscribeHike(1, 1).promise;
    expect(hikeApi).toHaveBeenCalledTimes(2);

    hikeApi.mockResolvedValue({ hike: null });
    await subscribeHike(2, 2).promise;
    vi.setSystemTime(Date.now() + HIKE_NONE_TTL_MS - 1000);
    await subscribeHike(2, 2).promise;
    expect(hikeApi).toHaveBeenCalledTimes(3);
    vi.setSystemTime(Date.now() + 2000);
    await subscribeHike(2, 2).promise;
    expect(hikeApi).toHaveBeenCalledTimes(4);

    hikeApi.mockRejectedValue(new Error("x"));
    await subscribeHike(3, 3).promise;
    vi.setSystemTime(Date.now() + HIKE_FAILURE_TTL_MS + 1000);
    await subscribeHike(3, 3).promise;
    expect(hikeApi).toHaveBeenCalledTimes(6);
  });

  it("keeps at most three requests in flight", async () => {
    const resolvers: (() => void)[] = [];
    hikeApi.mockImplementation(() => new Promise((r) => resolvers.push(() => r({ hike: null }))));
    const subs = [1, 2, 3, 4, 5].map((i) => subscribeHike(i, i));
    await Promise.resolve();
    await Promise.resolve();
    expect(hikeApi).toHaveBeenCalledTimes(HIKE_MAX_IN_FLIGHT);
    resolvers[0]();
    await subs[0].promise;
    await Promise.resolve();
    expect(hikeApi).toHaveBeenCalledTimes(HIKE_MAX_IN_FLIGHT + 1);
    resolvers.slice(1).forEach((r) => r());
    await vi.waitFor(() => expect(hikeApi.mock.calls.length).toBe(5));
    resolvers.forEach((r) => r());
    await Promise.all(subs.map((s) => s.promise));
  });

  it("aborts a request when its last subscriber leaves, and forgets it", async () => {
    let signal: AbortSignal | undefined;
    hikeApi.mockImplementation((_p: unknown, s: AbortSignal) => {
      signal = s;
      return new Promise(() => {});
    });
    const a = subscribeHike(1, 1);
    const b = subscribeHike(1, 1);
    await Promise.resolve();
    a.release();
    await new Promise((r) => setTimeout(r, 5));
    expect(signal?.aborted).toBe(false); // b is still waiting
    b.release();
    b.release(); // releasing twice is harmless
    await new Promise((r) => setTimeout(r, 5));
    expect(signal?.aborted).toBe(true);
    expect(hikeCacheSize()).toBe(0);
  });

  it("does not abort when a subscriber leaves and another arrives at once", async () => {
    let signal: AbortSignal | undefined;
    hikeApi.mockImplementation((_p: unknown, s: AbortSignal) => {
      signal = s;
      return new Promise(() => {});
    });
    const a = subscribeHike(1, 1);
    await Promise.resolve();
    a.release();
    subscribeHike(1, 1);
    await new Promise((r) => setTimeout(r, 5));
    expect(signal?.aborted).toBe(false);
    expect(hikeApi).toHaveBeenCalledTimes(1);
  });

  it("does not ask the server while offline, and asks again when back online", async () => {
    const nav = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(await subscribeHike(1, 1).promise).toBeNull();
    expect(hikeApi).not.toHaveBeenCalled();
    nav.mockReturnValue(true);
    hikeApi.mockResolvedValue({ hike: HIKE });
    expect(await subscribeHike(1, 1).promise).toEqual(HIKE);
  });
});
