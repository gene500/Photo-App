import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/nps-delicate-arch.json";
import { fetchNpsTrails, parseNpsTrails } from "./nps";

const feature = (props: Record<string, unknown>, geometry: unknown = { type: "LineString", coordinates: [[-109.5, 38.7], [-109.51, 38.71]] }) => ({ type: "Feature", properties: props, geometry });

describe("parseNpsTrails", () => {
  it("reads the real Delicate Arch answer: eight hiker lines", () => {
    const lines = parseNpsTrails(fixture)!;
    expect(lines).toHaveLength(8);
    expect(lines.every((l) => l.length >= 2 && l.every(([lng, lat]) => lng < -109 && lat > 38))).toBe(true);
  });
  it("flattens MultiLineString and drops bad points and one-point lines", () => {
    const json = { features: [feature({}, { type: "MultiLineString", coordinates: [[[1, 2], [3, 4]], [[5, 6]], [[7, 8], ["x", 1], [9, 10]]] })] };
    expect(parseNpsTrails(json)).toEqual([[[1, 2], [3, 4]], [[7, 8], [9, 10]]]);
  });
  it("skips bike/horse-only, road, water and closed trails but keeps unknown values", () => {
    const json = { features: [
      feature({ TRLUSE: "Bicycle" }), feature({ TRLUSE: "Hiker/Pedestrian", TRLTYPE: "Road" }), feature({ TRLTYPE: "Water Trail" }),
      feature({ TRLUSE: "Hiker/Pedestrian", TRLSTATUS: "Closed" }), feature({ TRLUSE: "Hiker/Pedestrian" }), feature({}), feature({ TRLUSE: "All Use" }),
    ] };
    expect(parseNpsTrails(json)).toHaveLength(3);
  });
  it("is null for anything that is not a feature collection, and [] for an empty one", () => {
    expect(parseNpsTrails(null)).toBeNull();
    expect(parseNpsTrails({ error: { code: 400 } })).toBeNull();
    expect(parseNpsTrails({ features: [] })).toEqual([]);
    expect(parseNpsTrails({ features: [null, { geometry: null }, { geometry: { type: "Point", coordinates: [1, 2] } }] })).toEqual([]);
  });
});

describe("fetchNpsTrails", () => {
  it("asks the fixed NPS layer for a small box as GeoJSON, with a User-Agent and a timeout", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(fixture)));
    const r = await fetchNpsTrails(38.7436, -109.4993, 0.027, f as unknown as typeof fetch);
    expect(r).toHaveLength(8);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails/FeatureServer/0/query");
    expect(u.searchParams.get("f")).toBe("geojson");
    expect(u.searchParams.get("geometry")).toBe("-109.52630,38.71660,-109.47230,38.77060");
    expect(u.searchParams.get("resultRecordCount")).toBe("500");
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/^RoadTripPhotoPlanner/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("is null on HTTP errors, network errors, bad JSON and ArcGIS error bodies", async () => {
    const run = (f: unknown) => fetchNpsTrails(1, 2, 0.02, f as typeof fetch);
    expect(await run(vi.fn(async () => new Response("no", { status: 500 })))).toBeNull();
    expect(await run(vi.fn().mockRejectedValue(new Error("x")))).toBeNull();
    expect(await run(vi.fn(async () => new Response("<html>")))).toBeNull();
    expect(await run(vi.fn(async () => new Response(JSON.stringify({ error: { code: 400 } }))))).toBeNull();
  });
});
