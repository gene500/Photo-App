import { describe, expect, it, vi } from "vitest";
import fixture from "../../../tests/fixtures/overpass-hours.json";
import { buildHoursQuery, createOsmHoursClient, OSM_BACKOFF_MS, OSM_HOURS_TTL_MS, OSM_MAX_STOPS, parseHoursElements } from "./osm-hours";

const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const cafe = { lat: 37.9, lng: -119.26 };

describe("parseHoursElements", () => {
  it("reads nodes and way centres, skipping rows without a position or a string tag", () => {
    expect(parseHoursElements(fixture)).toEqual([
      { lat: 37.9, lng: -119.26, hours: "Mo-Su 09:00-17:00" },
      { lat: 36, lng: -118, hours: "Mo-Fr 08:00-12:00" },
    ]);
    expect(parseHoursElements({})).toEqual([]);
  });
});

describe("buildHoursQuery", () => {
  it("is one batched query with only coordinates", () => {
    const q = buildHoursQuery([cafe, { lat: 1, lng: 2 }]);
    expect(q.match(/nwr\(/g)).toHaveLength(2);
    expect(q).toContain('["opening_hours"]');
  });
});

describe("OSM hours client", () => {
  it("batches all stops into one POST with a User-Agent and matches within 40 m", async () => {
    const f = vi.fn(async () => ok(fixture));
    const c = createOsmHoursClient({ fetchImpl: f as unknown as typeof fetch, url: () => "https://example.test/api" });
    const res = await c.hoursForPoints([cafe, { lat: 37.9003, lng: -119.26 }, { lat: 50, lng: 50 }]);
    expect(res).toEqual(["Mo-Su 09:00-17:00", "Mo-Su 09:00-17:00", null]);
    expect(f).toHaveBeenCalledTimes(1);
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/^RoadTripPhotoPlanner/);
  });
  it("caches for a day, caps the number of stops and never throws", async () => {
    let t = 0;
    const f = vi.fn(async () => ok(fixture));
    const c = createOsmHoursClient({ fetchImpl: f as unknown as typeof fetch, now: () => t });
    await c.hoursForPoints([cafe]);
    await c.hoursForPoints([cafe]);
    expect(f).toHaveBeenCalledTimes(1);
    t = OSM_HOURS_TTL_MS + 1;
    await c.hoursForPoints([cafe]);
    expect(f).toHaveBeenCalledTimes(2);
    const many = Array.from({ length: OSM_MAX_STOPS + 5 }, (_, i) => ({ lat: 10 + i, lng: 10 }));
    const out = await createOsmHoursClient({ fetchImpl: f as unknown as typeof fetch }).hoursForPoints(many);
    expect(out).toHaveLength(many.length);
    expect(String((f.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body).match(/nwr/g)).toHaveLength(OSM_MAX_STOPS);
  });
  it("backs off for 30 s after a 429 and yields null on errors or runtime-error remarks", async () => {
    let t = 0;
    const f = vi.fn(async () => new Response("", { status: 429 }));
    const c = createOsmHoursClient({ fetchImpl: f as unknown as typeof fetch, now: () => t });
    expect(await c.hoursForPoints([cafe])).toEqual([null]);
    expect(await c.hoursForPoints([{ lat: 1, lng: 1 }])).toEqual([null]);
    expect(f).toHaveBeenCalledTimes(1);
    t = OSM_BACKOFF_MS + 1;
    await c.hoursForPoints([{ lat: 2, lng: 2 }]);
    expect(f).toHaveBeenCalledTimes(2);
    const boom = createOsmHoursClient({ fetchImpl: (async () => { throw new Error("x"); }) as unknown as typeof fetch });
    expect(await boom.hoursForPoints([cafe])).toEqual([null]);
    const remark = createOsmHoursClient({ fetchImpl: (async () => ok({ remark: "runtime error: timeout", elements: [] })) as unknown as typeof fetch });
    expect(await remark.hoursForPoints([cafe])).toEqual([null]);
  });
});
