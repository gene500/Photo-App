import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LngLat } from "@/lib/types";
import { OverpassError } from "./overpass";
import { clearSuggestionCache, findSuggestions, findSuggestionsAround, routeCacheKey } from "./service";

const ROUTE: LngLat[] = [[-119.79, 36.74], [-119.6, 37.2], [-119.12, 37.96]];
const overpassJson = { elements: [{ type: "node", id: 1, lat: 37.2, lon: -119.6, tags: { tourism: "viewpoint", name: "Spot" } }] };

// Real Commons list=geosearch shape (3 files near the spot); popularity needs no key.
const commonsHits = { batchcomplete: "", query: { geosearch: [1, 2, 3].map((i) => ({ pageid: i, ns: 6, title: `File:${i}.jpg`, lat: 37.2, lon: -119.6, dist: i, primary: "" })) } };
const fetchImpl = vi.fn(async () => new Response(JSON.stringify(commonsHits))) as unknown as typeof fetch;
const offline = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;

describe("findSuggestions", () => {
  beforeEach(() => {
    clearSuggestionCache();
    delete process.env.EXTERNAL_APIS_FAKE;
    delete process.env.FLICKR_API_KEY;
  });

  it("queries Overpass with a polygon around the route and parses the result", async () => {
    const fetchOverpass = vi.fn<(query: string) => Promise<typeof overpassJson>>(async () => overpassJson);
    const result = await findSuggestions(ROUTE, { fetchOverpass, fetchImpl });
    expect(result).toEqual([{ osmId: "node/1", name: "Spot", lat: 37.2, lng: -119.6, kind: "viewpoint", popularity: 3 }]);
    expect(fetchOverpass.mock.calls[0][0]).toContain('(poly:"');
  });

  it("still returns suggestions (without popularity) when the popularity lookups fail", async () => {
    const result = await findSuggestions(ROUTE, { fetchOverpass: async () => overpassJson, fetchImpl: offline });
    expect(result).toEqual([{ osmId: "node/1", name: "Spot", lat: 37.2, lng: -119.6, kind: "viewpoint" }]);
  });

  it("serves repeat requests for the same route from cache", async () => {
    const fetchOverpass = vi.fn(async () => overpassJson);
    await findSuggestions(ROUTE, { fetchOverpass, fetchImpl });
    await findSuggestions(ROUTE, { fetchOverpass, fetchImpl });
    expect(fetchOverpass).toHaveBeenCalledTimes(1);
  });

  it("keys the cache on coordinates rounded to 4 decimals", () => {
    expect(routeCacheKey([[1.00001, 2], [3, 4]])).toBe(routeCacheKey([[1.00002, 2], [3, 4]]));
    expect(routeCacheKey([[1.001, 2], [3, 4]])).not.toBe(routeCacheKey([[1.002, 2], [3, 4]]));
  });

  it("returns fake suggestions without network in fake mode", async () => {
    process.env.EXTERNAL_APIS_FAKE = "1";
    const fetchOverpass = vi.fn();
    expect((await findSuggestions(ROUTE, { fetchOverpass }))[0].name).toBe("Fake Viewpoint");
    expect(fetchOverpass).not.toHaveBeenCalled();
  });

  it("wraps a corridor-building failure in a typed OverpassError instead of throwing unguarded", async () => {
    const fetchOverpass = vi.fn();
    // A single-point route can't build a route (buildCorridor requires >= 2 points).
    await expect(findSuggestions([[-119.79, 36.74]], { fetchOverpass })).rejects.toBeInstanceOf(
      OverpassError,
    );
    expect(fetchOverpass).not.toHaveBeenCalled();
  });
});

describe("findSuggestionsAround", () => {
  beforeEach(() => {
    clearSuggestionCache();
    delete process.env.EXTERNAL_APIS_FAKE;
    delete process.env.FLICKR_API_KEY;
  });

  it("queries a 24 km circle around the point, caches it apart from a route search", async () => {
    const fetchOverpass = vi.fn<(query: string) => Promise<typeof overpassJson>>(async () => overpassJson);
    const result = await findSuggestionsAround([-119.79, 36.74], { fetchOverpass, fetchImpl });
    expect(result).toHaveLength(1);
    expect(fetchOverpass.mock.calls[0][0]).toContain("(around:24000,36.74000,-119.79000)");
    await findSuggestionsAround([-119.79, 36.74], { fetchOverpass, fetchImpl });
    expect(fetchOverpass).toHaveBeenCalledTimes(1);
  });
});
