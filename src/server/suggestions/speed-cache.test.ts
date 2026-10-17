import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LngLat } from "@/lib/types";
import { TtlCache } from "./cache";
import { buildCorridor } from "./corridor";
import { createRingTester, pointInRing } from "./places-grid";
import { clearSuggestionCache, findSuggestions, SUGGESTION_CACHE_TTL_MS, SUGGESTION_STALE_GRACE_MS } from "./service";

describe("TtlCache stale grace", () => {
  it("serves an expired entry through getStale (fresh=false) until the grace ends, but never through get", () => {
    let now = 0;
    const cache = new TtlCache<string>(1000, 10, () => now, 500);
    cache.set("k", "v");
    expect(cache.getStale("k")).toEqual({ value: "v", fresh: true });
    now = 1200;
    expect(cache.get("k")).toBeUndefined();
    expect(cache.getStale("k")).toEqual({ value: "v", fresh: false });
    now = 1500;
    expect(cache.getStale("k")).toBeUndefined();
  });

  it("has no grace by default", () => {
    let now = 0;
    const cache = new TtlCache<string>(1000, 10, () => now);
    cache.set("k", "v");
    now = 1000;
    expect(cache.getStale("k")).toBeUndefined();
  });
});

describe("createRingTester", () => {
  it("agrees with pointInRing on a real corridor, inside, outside and on the bounding box edge", () => {
    const route: LngLat[] = Array.from({ length: 120 }, (_, i) => [-112.5 + i * 0.04, 38.5 + Math.sin(i / 7) * 0.15] as LngLat);
    const ring = buildCorridor(route);
    const test = createRingTester(ring);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let inside = 0;
    for (let i = 0; i < 20_000; i++) {
      const lng = -112.7 + rnd() * 5.2;
      const lat = 38.2 + rnd() * 0.6;
      const expected = pointInRing(lng, lat, ring);
      if (expected) inside++;
      expect(test(lng, lat)).toBe(expected);
    }
    expect(inside).toBeGreaterThan(100); // the comparison was not vacuous
    for (const [lng, lat] of ring) expect(test(lng, lat)).toBe(pointInRing(lng, lat, ring));
  });

  it("agrees with pointInRing for every point of a grid around a concave polygon", () => {
    const ring: LngLat[] = [[0, 0], [10, 0], [10, 10], [5, 4], [0, 10]];
    const inside = createRingTester(ring);
    for (let lng = -2; lng <= 12; lng += 0.5) for (let lat = -2; lat <= 12; lat += 0.5) expect(inside(lng, lat)).toBe(pointInRing(lng, lat, ring));
  });

  it("handles a degenerate flat ring", () => {
    const flat: LngLat[] = [[0, 1], [1, 1], [2, 1]];
    expect(createRingTester(flat)(1, 1)).toBe(pointInRing(1, 1, flat));
  });
});

describe("stale-while-revalidate for finished suggestions", () => {
  const ROUTE: LngLat[] = [[-119.79, 36.74], [-119.6, 37.2], [-119.12, 37.96]];
  const json = (name: string) => ({ elements: [{ type: "node", id: 1, lat: 37.2, lon: -119.6, tags: { tourism: "viewpoint", name } }] });
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ query: { geosearch: [{}, {}] } }))) as unknown as typeof fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    clearSuggestionCache();
    delete process.env.EXTERNAL_APIS_FAKE;
    delete process.env.FLICKR_API_KEY;
  });
  afterEach(() => vi.useRealTimers());

  it("answers an expired result immediately and rebuilds it in the background, once", async () => {
    let name = "Old";
    const fetchOverpass = vi.fn(async () => json(name));
    const deferred: Promise<unknown>[] = [];
    const defer = (p: Promise<unknown>) => void deferred.push(p);

    expect((await findSuggestions(ROUTE, { fetchOverpass, fetchImpl, defer }))[0].name).toBe("Old");
    vi.setSystemTime(Date.now() + SUGGESTION_CACHE_TTL_MS + 1000);
    name = "New";
    const second = await findSuggestions(ROUTE, { fetchOverpass, fetchImpl, defer });
    const third = await findSuggestions(ROUTE, { fetchOverpass, fetchImpl, defer });
    expect(second[0].name).toBe("Old"); // instant, stale
    expect(third[0].name).toBe("Old");
    expect(deferred).toHaveLength(1); // one refresh, not one per request
    await Promise.all(deferred);
    expect((await findSuggestions(ROUTE, { fetchOverpass, fetchImpl, defer }))[0].name).toBe("New");
  });

  it("reports a stale answer as complete, once, and keeps the background rebuild silent", async () => {
    let name = "Old";
    const fetchOverpass = vi.fn(async () => json(name));
    const deferred: Promise<unknown>[] = [];
    const defer = (p: Promise<unknown>) => void deferred.push(p);
    await findSuggestions(ROUTE, { fetchOverpass, fetchImpl, defer });
    vi.setSystemTime(Date.now() + SUGGESTION_CACHE_TTL_MS + 1000);
    name = "New";
    const onResult = vi.fn();
    await findSuggestions(ROUTE, { fetchOverpass, fetchImpl, defer, onResult });
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith({ degraded: false });
    await Promise.all(deferred); // the rebuild runs after the response and must not call back through onResult
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("does not serve a result older than the grace period", async () => {
    let name = "Old";
    const fetchOverpass = vi.fn(async () => json(name));
    await findSuggestions(ROUTE, { fetchOverpass, fetchImpl });
    vi.setSystemTime(Date.now() + SUGGESTION_CACHE_TTL_MS + SUGGESTION_STALE_GRACE_MS + 1000);
    name = "New";
    expect((await findSuggestions(ROUTE, { fetchOverpass, fetchImpl }))[0].name).toBe("New");
  });
});
