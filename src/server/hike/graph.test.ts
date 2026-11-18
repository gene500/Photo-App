import { describe, expect, it } from "vitest";
import type { LngLat } from "@/lib/types";
import nps from "./fixtures/nps-delicate-arch.json";
import osm from "./fixtures/osm-delicate-arch.json";
import { Graph, findHikePath, lineLengthMeters, simplifyLine } from "./graph";
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

  it("starts at a parking lot (tier 0) even when a trailhead is closer by walking, and reports which one", () => {
    const trail = line([0, 0], [800, 0], [1600, 0]);
    const lots = [p(5000, 0), p(0, 0)]; // the first does not snap to the trail
    const heads = [p(1200, 0)];
    const path = findHikePath([trail], at(1600, 0), { trailheadTiers: [lots, heads] });
    expect(path?.start).toEqual({ kind: "tier", tier: 0, index: 1 });
    expect(path?.distanceMeters).toBeCloseTo(1600, -1);
  });

  it("skips a tier whose nearest point is farther than tierMaxM and tries the next tier", () => {
    const trail = line([0, 0], [3000, 0], [6000, 0]);
    const opts = { trailheadTiers: [[p(0, 0)], [p(3000, 0)]], tierMaxM: [5000, undefined] };
    const path = findHikePath([trail], at(6000, 0), opts);
    expect(path?.start).toEqual({ kind: "tier", tier: 1, index: 0 });
    expect(path?.distanceMeters).toBeCloseTo(3000, -1);
    // 4 km away is within the cap: the lot still wins.
    const near = findHikePath([line([0, 0], [4000, 0])], at(4000, 0), opts);
    expect(near?.start).toEqual({ kind: "tier", tier: 0, index: 0 });
    // Nothing capped when tierMaxM is not given.
    expect(findHikePath([trail], at(6000, 0), { trailheadTiers: opts.trailheadTiers })?.start).toEqual({ kind: "tier", tier: 0, index: 0 });
  });

  it("uses the dead end when every tier is capped out", () => {
    const path = findHikePath([line([0, 0], [6000, 0])], at(6000, 0), { trailheadTiers: [[p(0, 0)]], tierMaxM: [5000] });
    expect(path?.start).toEqual({ kind: "dead-end" });
  });

  it("uses the second tier when no lot snaps to a trail", () => {
    const path = findHikePath([line([0, 0], [1600, 0])], at(1600, 0), { trailheadTiers: [[p(0, 5000)], [p(400, 0)]] });
    expect(path?.start).toEqual({ kind: "tier", tier: 1, index: 0 });
  });

  it("reports a dead-end start when no tier point snaps", () => {
    const path = findHikePath([line([0, 0], [1000, 0])], at(1000, 0), { trailheadTiers: [[p(0, 5000)], []] });
    expect(path?.start).toEqual({ kind: "dead-end" });
    expect(findHikePath([line([0, 0], [1000, 0])], at(1000, 0))?.start).toEqual({ kind: "dead-end" });
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
    const path = findHikePath(o.segments, arch, { trailheadTiers: [o.parking, o.trailheads].map((t) => t.map((l) => l.point)) });
    expect(path).not.toBeNull();
    expect(path!.distanceMeters).toBeGreaterThan(2500);
    expect(path!.distanceMeters).toBeLessThan(6500);
    // ends at the Delicate Arch trailhead
    const [lng, lat] = path!.coords[0];
    expect(Math.hypot(lng - -109.52044, lat - 38.73569)).toBeLessThan(0.002);
  });
});

describe("Graph.nearestEdge (grid search)", () => {
  it("gives the same edge, point and distance as scanning every edge in order, with dead edges, a skipped node, long edges and a distance cap", () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const g = new Graph(6);
    const nodes: number[] = [];
    for (let i = 0; i < 400; i++) nodes.push(g.node(rnd() * 3000 - 1500, rnd() * 3000 - 1500));
    for (let i = 0; i < 600; i++) g.edge(nodes[Math.floor(rnd() * nodes.length)], nodes[Math.floor(rnd() * nodes.length)]); // some are very long
    for (let i = 0; i < 40; i++) g.split(Math.floor(rnd() * g.edges.length), g.node(rnd() * 3000 - 1500, rnd() * 3000 - 1500));
    const brute = (x: number, y: number, skip: number, maxD: number) => {
      let best: { index: number; x: number; y: number; d: number } | null = null;
      g.edges.forEach((e, index) => {
        if (!e.alive || e.a === skip || e.b === skip) return;
        const ax = g.xs[e.a], ay = g.ys[e.a], dx = g.xs[e.b] - ax, dy = g.ys[e.b] - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
        const px = ax + t * dx, py = ay + t * dy;
        const d = Math.hypot(x - px, y - py);
        if (!best || d < best.d) best = { index, x: px, y: py, d };
      });
      return best && (best as { d: number }).d <= maxD ? best : null;
    };
    for (let q = 0; q < 300; q++) {
      const x = rnd() * 4000 - 2000, y = rnd() * 4000 - 2000;
      const skip = q % 3 === 0 ? nodes[q % nodes.length] : -1;
      const maxD = q % 2 === 0 ? Infinity : 150;
      expect(g.nearestEdge(x, y, skip, maxD)).toEqual(brute(x, y, skip, maxD));
    }
  });
});
