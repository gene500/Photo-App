import { beforeEach, describe, expect, it } from "vitest";
import type { LngLat } from "@/lib/types";
import { clearSuggestionCache, findSuggestions } from "./service";

const LOOP: LngLat[] = [[-100, 40], [-99, 40], [-99, 41], [-100, 41], [-100, 40]];
const el = (id: number, lat: number, lon: number) => ({ type: "node", id, lat, lon, tags: { tourism: "viewpoint", name: `V${id}` } });
const noLocal = { local: async () => null, localPartial: async () => null, enrich: false };

describe("a loop route against the Overpass 500-element cap", () => {
  beforeEach(() => clearSuggestionCache());

  it("marks the result degraded and does not cache it when the cap was hit and the hole's content was dropped", async () => {
    let calls = 0;
    const inHole = Array.from({ length: 500 }, (_, i) => el(i + 1, 40.5 + (i % 20) * 0.001, -99.5 + Math.floor(i / 20) * 0.001));
    const fetchOverpass = async () => (++calls, { elements: inHole });
    let degraded: boolean | undefined;
    const out = await findSuggestions(LOOP, { ...noLocal, fetchOverpass, onResult: (i) => { degraded = i.degraded; } });
    expect(out).toEqual([]);
    expect(degraded).toBe(true);
    await findSuggestions(LOOP, { ...noLocal, fetchOverpass });
    expect(calls).toBe(2); // not served from cache
  });

  it("still caches a result when the cap was not hit", async () => {
    let calls = 0;
    const fetchOverpass = async () => (++calls, { elements: [el(1, 40.5, -99.5)] });
    await findSuggestions(LOOP, { ...noLocal, fetchOverpass });
    await findSuggestions(LOOP, { ...noLocal, fetchOverpass });
    expect(calls).toBe(1);
  });
});
