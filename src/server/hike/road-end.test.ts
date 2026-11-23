import { describe, expect, it } from "vitest";
import fixture from "./fixtures/overpass-arches-road-end.json";
import type { LngLat } from "@/lib/types";
import { haversineMeters } from "@/lib/geo";
import { chooseRoadEnd, nearestRoadDistanceM, parseRoadEnd, roadEndQuery, ROAD_NEAR_M, ROAD_SEARCH_M, type RoadData } from "./road-end";

const STOP = { lat: 38.7436, lng: -109.4993 };
const M_LAT = 1 / 111_320;
const mLng = (lat: number) => 1 / (111_320 * Math.cos((lat * Math.PI) / 180));
const dist = (a: LngLat, b: { lat: number; lng: number }) => haversineMeters({ lat: a[1], lng: a[0] }, b);
/** An east-west road `m` metres north (+) or south (-) of the stop, 4 km long, with vertices every 500 m. */
const roadAt = (m: number, at = STOP): LngLat[] => Array.from({ length: 17 }, (_, i): LngLat => [at.lng + (i - 8) * 500 * mLng(at.lat), at.lat + m * M_LAT]);
const trailTo = (m: number, at = STOP): LngLat[] => Array.from({ length: 11 }, (_, i): LngLat => [at.lng, at.lat + (m * M_LAT * (10 - i)) / 10]);

describe("constants", () => {
  it("has the spec values", () => {
    expect(ROAD_NEAR_M).toBe(100);
    expect(ROAD_SEARCH_M).toBe(5000);
  });
});

describe("roadEndQuery", () => {
  const q = roadEndQuery(STOP.lat, STOP.lng, 5000);
  it("is a boxed, size-capped query for drivable highways", () => {
    expect(q).toContain("[timeout:10]");
    expect(q).toContain("maxsize");
    expect(q).not.toContain("around:");
    const roadRegex = q.match(/"highway"~"\^\(([^)]*)\)\$"/g) ?? [];
    expect(roadRegex.length).toBeGreaterThanOrEqual(2);
    const roads = roadRegex.find((r) => r.includes("secondary"))!;
    expect(roads).toBeDefined();
    expect(roads).not.toContain("driveway");
    expect(roads).not.toContain("track");
    expect(roads).toContain("residential");
  });
  it("also asks for walkable ways", () => {
    expect(q).toContain("path|footway|track|steps|bridleway");
    expect(q).toContain("out tags geom");
  });
});

describe("roadEndQuery input", () => {
  it("throws on non-finite coordinates", () => {
    expect(() => roadEndQuery(NaN, STOP.lng, 5000)).toThrow(/finite/);
    expect(() => roadEndQuery(STOP.lat, Infinity, 5000)).toThrow(/finite/);
  });
});

describe("parseRoadEnd", () => {
  const data = parseRoadEnd(fixture)!;
  it("splits roads from trails and drops driveways and private roads", () => {
    expect(data.roads).toHaveLength(1);
    expect(data.trails).toHaveLength(1);
    expect(data.roads[0]).toHaveLength(9);
    expect(data.trails[0]).toHaveLength(11);
  });
  it("returns null when there is no element list", () => {
    expect(parseRoadEnd({})).toBeNull();
    expect(parseRoadEnd(null)).toBeNull();
  });
  it("drops short ways and out-of-range points", () => {
    const g = (...p: [number, number][]) => p.map(([lat, lon]) => ({ lat, lon }));
    const out = parseRoadEnd({
      elements: [
        { type: "way", tags: { highway: "secondary" }, geometry: g([1, 2]) },
        { type: "way", tags: { highway: "secondary" }, geometry: g([1, 2], [95, 2], [1, 200]) },
        { type: "way", tags: { highway: "secondary" }, geometry: g([1, 2], [95, 2], [1.001, 2]) },
        { type: "way", tags: { highway: "path" }, geometry: g([1, 2], [1.001, 2]) },
        { type: "way", tags: { highway: "residential", motor_vehicle: "no" }, geometry: g([1, 2], [1.001, 2]) },
        { type: "way", tags: { highway: "service", service: "parking_aisle" }, geometry: g([1, 2], [1.001, 2]) },
        { type: "way", tags: { highway: "track", name: "Hole Road" }, geometry: g([1, 2], [1.001, 2]) },
      ],
    })!;
    expect(out.roads).toEqual([[[2, 1], [2, 1.001]]]);
    expect(out.trails).toEqual([[[2, 1], [2, 1.001]]]);
  });
});

describe("nearestRoadDistanceM", () => {
  it("is Infinity with no roads and the distance to the nearest segment otherwise", () => {
    expect(nearestRoadDistanceM([], STOP)).toBe(Infinity);
    expect(nearestRoadDistanceM([roadAt(-250)], STOP)).toBeCloseTo(250, 0);
  });
});

describe("chooseRoadEnd", () => {
  it("finds the road end and trail on the Arches fixture", () => {
    const data = parseRoadEnd(fixture)!;
    const c = chooseRoadEnd(data, STOP);
    expect(c.kind).toBe("road-end");
    if (c.kind !== "road-end") return;
    const meet = data.trails[0][0];
    expect(dist(c.point, { lat: meet[1], lng: meet[0] })).toBeLessThan(25);
    expect(c.trail).not.toBeNull();
    expect(dist(c.trail![0], { lat: c.point[1], lng: c.point[0] })).toBeLessThan(1);
    expect(dist(c.trail![c.trail!.length - 1], STOP)).toBeLessThan(5);
    expect(c.walkMeters).toBeGreaterThanOrEqual(1000);
    expect(c.walkMeters).toBeLessThanOrEqual(1300);
    expect(c.walkMeters % 10).toBe(0);
  });
  it("treats 99 m from a road as near-road and 101 m as a road end", () => {
    const near: RoadData = { roads: [roadAt(-99)], trails: [] };
    const far: RoadData = { roads: [roadAt(-101)], trails: [] };
    expect(nearestRoadDistanceM(near.roads, STOP)).toBeLessThanOrEqual(100);
    expect(nearestRoadDistanceM(far.roads, STOP)).toBeGreaterThan(100);
    expect(chooseRoadEnd(near, STOP)).toEqual({ kind: "near-road" });
    expect(chooseRoadEnd(far, STOP).kind).toBe("road-end");
  });
  it("falls back to the nearest point on the nearest road when no trail connects", () => {
    const road = roadAt(-3000);
    const c = chooseRoadEnd({ roads: [road], trails: [] }, STOP);
    expect(c.kind).toBe("road-end");
    if (c.kind !== "road-end") return;
    expect(c.trail).toBeNull();
    expect(Math.abs(c.point[1] - road[0][1]) / M_LAT).toBeLessThan(1);
    expect(Math.abs(c.point[0] - STOP.lng) / mLng(STOP.lat)).toBeLessThan(1);
    expect(c.walkMeters).toBeGreaterThan(2950);
    expect(c.walkMeters).toBeLessThan(3050);
    expect(c.walkMeters % 10).toBe(0);
  });
  it("falls back to a straight road end when the trail walk is over 5000 m", () => {
    const k = 3000 * mLng(STOP.lat);
    const d = 3000 * M_LAT;
    const detour: LngLat[] = [[STOP.lng, STOP.lat], [STOP.lng + k, STOP.lat], [STOP.lng + k, STOP.lat - d], [STOP.lng + 2 * k, STOP.lat - d]];
    const c = chooseRoadEnd({ roads: [roadAt(-3000)], trails: [detour] }, STOP);
    expect(c.kind).toBe("road-end");
    if (c.kind === "road-end") expect(c.trail).toBeNull();
  });
  it("returns none with no roads, or when the nearest road is beyond 5000 m", () => {
    expect(chooseRoadEnd({ roads: [], trails: [] }, STOP)).toEqual({ kind: "none" });
    expect(chooseRoadEnd({ roads: [roadAt(-5200)], trails: [trailTo(-5200)] }, STOP)).toEqual({ kind: "none" });
  });
  it("picks the nearest road that has a trail to the stop, not the nearest by straight line", () => {
    const nearer = roadAt(500);
    const farther = roadAt(-1500);
    const c = chooseRoadEnd({ roads: [nearer, farther], trails: [trailTo(-1500)] }, STOP);
    expect(c.kind).toBe("road-end");
    if (c.kind !== "road-end") return;
    expect(c.trail).not.toBeNull();
    expect(c.point[1]).toBeCloseTo(farther[0][1], 4);
    expect(c.walkMeters).toBeGreaterThan(1450);
    expect(c.walkMeters).toBeLessThan(1550);
  });
  it("ends the trail at the stop when the trail node is 100 m short of it", () => {
    const trail = Array.from({ length: 10 }, (_, i): LngLat => [STOP.lng, STOP.lat - (1500 - (i * 1400) / 9) * M_LAT]);
    const c = chooseRoadEnd({ roads: [roadAt(-1500)], trails: [trail] }, STOP);
    expect(c.kind).toBe("road-end");
    if (c.kind !== "road-end") return;
    expect(c.trail).not.toBeNull();
    const last = c.trail![c.trail!.length - 1];
    expect(dist(last, STOP)).toBeLessThan(1);
    expect(dist(trail[trail.length - 1], STOP)).toBeGreaterThan(90);
    expect(c.walkMeters).toBeGreaterThan(1480);
    expect(c.walkMeters).toBeLessThan(1520);
  });
  it("snaps a trail that meets the road mid-segment", () => {
    const road: LngLat[] = [[STOP.lng - 2000 * mLng(STOP.lat), STOP.lat - 1500 * M_LAT], [STOP.lng + 2000 * mLng(STOP.lat), STOP.lat - 1500 * M_LAT]];
    const c = chooseRoadEnd({ roads: [road], trails: [trailTo(-1500)] }, STOP);
    expect(c.kind).toBe("road-end");
    if (c.kind !== "road-end") return;
    expect(c.trail).not.toBeNull();
    expect(Math.abs(c.point[1] - road[0][1]) / M_LAT).toBeLessThan(1);
    expect(Math.abs(c.point[0] - STOP.lng) / mLng(STOP.lat)).toBeLessThanOrEqual(25);
    expect(dist(c.trail![c.trail!.length - 1], STOP)).toBeLessThan(5);
    expect(c.walkMeters).toBeGreaterThan(1450);
    expect(c.walkMeters).toBeLessThan(1560);
  });
});
