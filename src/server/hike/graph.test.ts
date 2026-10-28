import { describe, expect, it } from "vitest";
import type { LngLat } from "@/lib/types";
import nps from "./fixtures/nps-delicate-arch.json";
import osm from "./fixtures/osm-delicate-arch.json";
import { findHikePath, lineLengthMeters, simplifyLine } from "./graph";
import { parseNpsTrails } from "./nps";
import { parseOsm } from "./osm";

// Flat test world near (0, 40): 0.001 deg of latitude is 111.3 m.
const LAT = 40;
const p = (eastM: number, northM: number): LngLat => [eastM / (111_320 * Math.cos((LAT * Math.PI) / 180)), LAT + northM / 111_320];
const at = (eastM: number, northM: number) => ({ lat: LAT + northM / 111_320, lng: p(eastM, northM)[0] });
const line = (...pts: [number, number][]) => pts.map(([e, n]) => p(e, n));

describe("lineLengthMeters", () => {
  it("measures a one-degree meridian arc", () => {
    expect(lineLengthMeters([[0, 40], [0, 41]])).toBeGreaterThan(111_000);
    expect(lineLengthMeters([[0, 40], [0, 41]])).toBeLessThan(111_400);
  });
  it("is zero for a single point", () => {
    expect(lineLengthMeters([[0, 40]])).toBe(0);
  });
});

describe("findHikePath", () => {
  it("walks a simple path from its dead end to the place", () => {
    const path = findHikePath([line([0, 0], [500, 0], [1000, 0])], at(1000, 0));
    expect(path?.distanceMeters).toBeCloseTo(1000, -1);
    expect(path?.coords[0][0]).toBeCloseTo(p(0, 0)[0], 5); // starts at the far end, the trailhead
  });

  it("stitches segments whose ends nearly touch", () => {
    const path = findHikePath([line([0, 0], [400, 0]), line([402, 1], [900, 0])], at(900, 0));
    expect(path?.distanceMeters).toBeCloseTo(900, -1);
  });

  it("joins a trail that ends on the side of another", () => {
    const path = findHikePath([line([0, 0], [1000, 0]), line([500, 4], [500, 600])], at(500, 600));
    // Nearest dead end is the left end of the main trail: 500 m along it, then 600 m up the branch.
    expect(Math.abs(path!.distanceMeters - 1100)).toBeLessThan(15);
  });

  it("takes the shortest way at a branching", () => {
    // Two routes to the place (a short one and a long detour); the trailhead is a dead end at the west.
    const short = line([0, 0], [500, 0], [1000, 0]);
    const detour = line([500, 0], [500, 400], [1000, 400], [1000, 0]);
    const path = findHikePath([short, detour], at(1000, 0));
    expect(path?.distanceMeters).toBeCloseTo(1000, -1);
  });

  it("prefers a listed trailhead over a nearer dead end", () => {
    const trail = line([0, 0], [800, 0], [1600, 0]);
    const spur = line([800, 0], [800, 300]); // a dead end 300 m from the junction
    const path = findHikePath([trail, spur], at(800, 300), { trailheadTiers: [[p(0, 0)]] });
    expect(path?.distanceMeters).toBeCloseTo(1100, -1);
  });

  it("ignores a trailhead that is not on any connected trail", () => {
    const path = findHikePath([line([0, 0], [1000, 0])], at(1000, 0), { trailheadTiers: [[p(0, 5000)]] });
    expect(path?.distanceMeters).toBeCloseTo(1000, -1); // falls back to the dead end
  });

  it("finds no hike across a gap in the trails", () => {
    // The place sits on a separate piece with no dead end farther than the minimum.
    expect(findHikePath([line([0, 0], [1000, 0]), line([3000, 0], [3050, 0])], at(3025, 0))).toBeNull();
  });

  it("only reaches trailheads on the same connected piece", () => {
    const pieces = [line([0, 0], [1000, 0]), line([3000, 0], [3600, 0])];
    const path = findHikePath(pieces, at(3600, 0), { trailheadTiers: [[p(0, 0)]] });
    expect(path?.distanceMeters).toBeCloseTo(600, -1); // the dead end of its own piece, not the unreachable trailhead
  });

  it("finds nothing when no trail is near the place", () => {
    expect(findHikePath([line([0, 0], [1000, 0])], at(500, 2000))).toBeNull();
  });

  it("finds nothing with no trails at all", () => {
    expect(findHikePath([], at(0, 0))).toBeNull();
  });

  it("says no hike when the place is at the trailhead", () => {
    expect(findHikePath([line([0, 0], [1000, 0])], at(40, 0), { trailheadTiers: [[p(0, 0)]] })).toBeNull();
  });

  it("does not offer a walk longer than the limit", () => {
    expect(findHikePath([line([0, 0], [40_000, 0])], at(40_000, 0), { maxM: 30_000 })).toBeNull();
  });

  it("ignores a runaway number of vertices", () => {
    expect(findHikePath([line([0, 0], [100, 0])], at(100, 0), { maxVertices: 1 })).toBeNull();
  });
});

describe("simplifyLine", () => {
  it("drops points on a straight run and rounds to five decimals", () => {
    const l = line([0, 0], [100, 0.1], [200, 0], [300, 0]);
    const out = simplifyLine(l, 200, at(0, 0));
    expect(out).toHaveLength(2);
    for (const [lng, lat] of out) {
      expect(Math.round(lng * 1e5)).toBeCloseTo(lng * 1e5, 6);
      expect(Math.round(lat * 1e5)).toBeCloseTo(lat * 1e5, 6);
    }
  });
  it("caps the number of points", () => {
    const zig = Array.from({ length: 1000 }, (_, i) => p(i * 5, (i % 2) * 30 + Math.sin(i) * 20));
    expect(simplifyLine(zig, 100, at(0, 0)).length).toBeLessThanOrEqual(100);
  });
});

describe("real Delicate Arch fixtures (Arches National Park)", () => {
  const arch = { lat: 38.7436, lng: -109.4993 };
  it("NPS trails: the Delicate Arch Viewpoint walk is found (about half a kilometre)", () => {
    const path = findHikePath(parseNpsTrails(nps)!, { lat: 38.73787, lng: -109.49995 });
    expect(path).not.toBeNull();
    expect(path!.distanceMeters).toBeGreaterThan(300);
    expect(path!.distanceMeters).toBeLessThan(900);
  });
  it("NPS trails: the arch itself is 600 m from any mapped NPS trail (the layer is incomplete there), so no NPS hike", () => {
    expect(findHikePath(parseNpsTrails(nps)!, arch)).toBeNull();
  });
  it("OSM ways with the trailhead node give about the same walk", () => {
    const o = parseOsm(osm)!;
    expect(o.trailheads).toHaveLength(2);
    const path = findHikePath(o.segments, arch, { trailheadTiers: [o.trailheads, o.parking].filter((t) => t.length) });
    expect(path).not.toBeNull();
    expect(path!.distanceMeters).toBeGreaterThan(2500);
    expect(path!.distanceMeters).toBeLessThan(6500);
    // ends at the Delicate Arch trailhead
    const [lng, lat] = path!.coords[0];
    expect(Math.hypot(lng - -109.52044, lat - 38.73569)).toBeLessThan(0.002);
  });
});
