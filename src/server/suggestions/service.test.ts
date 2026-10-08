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

  it("enrich:false answers without any popularity lookup, and a later full request reuses the raw Overpass result", async () => {
    const fetchOverpass = vi.fn(async () => overpassJson);
    const noPopularity = vi.fn() as unknown as typeof fetch;
    const fast = await findSuggestions(ROUTE, { fetchOverpass, fetchImpl: noPopularity, enrich: false });
    expect(fast).toEqual([{ osmId: "node/1", name: "Spot", lat: 37.2, lng: -119.6, kind: "viewpoint" }]);
    expect(noPopularity).not.toHaveBeenCalled();
    const full = await findSuggestions(ROUTE, { fetchOverpass, fetchImpl });
    expect(full[0].popularity).toBe(3);
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
    const query = fetchOverpass.mock.calls[0][0];
    expect(query).toContain("(around:24000,36.74000,-119.79000)");
    // Viewpoints, peaks and attractions are capped separately so dense attractions can't crowd the rest out.
    expect(query).toContain('nwr["tourism"="viewpoint"]');
    expect(query).toContain('node["natural"="peak"]["name"]');
    expect(query).toContain('nwr["tourism"="attraction"]');
    expect(query.match(/ out center \d+;/g)).toHaveLength(3);
    await findSuggestionsAround([-119.79, 36.74], { fetchOverpass, fetchImpl });
    expect(fetchOverpass).toHaveBeenCalledTimes(1);
  });

  it("uses a custom radius and caches it apart from the default one", async () => {
    const fetchOverpass = vi.fn<(query: string) => Promise<typeof overpassJson>>(async () => overpassJson);
    await findSuggestionsAround([-119.79, 36.74], { fetchOverpass, fetchImpl }, 10);
    expect(fetchOverpass.mock.calls[0][0]).toContain("(around:10000,36.74000,-119.79000)");
    await findSuggestionsAround([-119.79, 36.74], { fetchOverpass, fetchImpl });
    expect(fetchOverpass).toHaveBeenCalledTimes(2);
    expect(fetchOverpass.mock.calls[1][0]).toContain("(around:24000,");
  });

  it("returns the fake suggestions in offline mode without calling Overpass", async () => {
    process.env.EXTERNAL_APIS_FAKE = "1";
    const fetchOverpass = vi.fn();
    const result = await findSuggestionsAround([-119.79, 36.74], { fetchOverpass });
    expect(result).toHaveLength(3);
    expect(fetchOverpass).not.toHaveBeenCalled();
    delete process.env.EXTERNAL_APIS_FAKE;
  });
});

describe("local copy of the map data", () => {
  const local = (n: number) => async () => Array.from({ length: n }, (_, i) => ({ type: "node", id: i + 1, lat: 37.2 + i / 1000, lon: -119.6, tags: { tourism: "viewpoint", name: `Spot ${i}` } }));

  beforeEach(() => {
    clearSuggestionCache();
    delete process.env.EXTERNAL_APIS_FAKE;
  });

  it("answers from the local copy without asking Overpass", async () => {
    const fetchOverpass = vi.fn();
    const result = await findSuggestionsAround([-119.6, 37.2], { local: local(8), fetchOverpass, enrich: false });
    expect(result).toHaveLength(8);
    expect(fetchOverpass).not.toHaveBeenCalled();
  });

  it("asks Overpass when the copy does not cover the area or is nearly empty", async () => {
    const fetchOverpass = vi.fn(async () => overpassJson);
    expect(await findSuggestionsAround([-0.1, 51.5], { local: async () => null, fetchOverpass, enrich: false })).toHaveLength(1);
    clearSuggestionCache();
    expect(await findSuggestionsAround([-119.6, 37.2], { local: local(2), fetchOverpass, enrich: false })).toHaveLength(1);
    expect(fetchOverpass).toHaveBeenCalledTimes(2);
  });

  it("falls back to a thin local answer when Overpass fails, and fails only when there is nothing local", async () => {
    const down = vi.fn().mockRejectedValue(new OverpassError("busy"));
    expect(await findSuggestionsAround([-119.6, 37.2], { local: local(2), fetchOverpass: down, enrich: false })).toHaveLength(2);
    clearSuggestionCache();
    await expect(findSuggestionsAround([-119.6, 37.2], { local: async () => null, fetchOverpass: down, enrich: false })).rejects.toBeInstanceOf(OverpassError);
  });

  it("a database error in the local lookup quietly falls back to Overpass", async () => {
    const fetchOverpass = vi.fn(async () => overpassJson);
    const result = await findSuggestionsAround([-119.6, 37.2], { local: async () => { throw new Error("no such table: Place"); }, fetchOverpass, enrich: false });
    expect(result).toHaveLength(1);
  });

  it("route searches use the local copy too", async () => {
    const fetchOverpass = vi.fn();
    const result = await findSuggestions(ROUTE, { local: local(6), fetchOverpass, enrich: false });
    expect(result).toHaveLength(6);
    expect(fetchOverpass).not.toHaveBeenCalled();
  });
});
