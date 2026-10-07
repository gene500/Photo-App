import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LngLat } from "@/lib/types";
import { clearSuggestionCache, findSuggestions, routeCacheKey } from "./service";

const ROUTE: LngLat[] = [[-119.79, 36.74], [-119.6, 37.2], [-119.12, 37.96]];
const overpassJson = { elements: [{ type: "node", id: 1, lat: 37.2, lon: -119.6, tags: { tourism: "viewpoint", name: "Spot" } }] };

describe("findSuggestions", () => {
  beforeEach(() => {
    clearSuggestionCache();
    delete process.env.EXTERNAL_APIS_FAKE;
  });

  it("queries Overpass with a polygon around the route and parses the result", async () => {
    const fetchOverpass = vi.fn<(query: string) => Promise<typeof overpassJson>>(async () => overpassJson);
    const result = await findSuggestions(ROUTE, { fetchOverpass });
    expect(result).toEqual([{ osmId: "node/1", name: "Spot", lat: 37.2, lng: -119.6, kind: "viewpoint" }]);
    expect(fetchOverpass.mock.calls[0][0]).toContain('(poly:"');
  });

  it("serves repeat requests for the same route from cache", async () => {
    const fetchOverpass = vi.fn(async () => overpassJson);
    await findSuggestions(ROUTE, { fetchOverpass });
    await findSuggestions(ROUTE, { fetchOverpass });
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
});
