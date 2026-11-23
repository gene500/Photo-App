import { describe, expect, it } from "vitest";
import type { LngLat, Stop } from "@/lib/types";
import { trailLines } from "./trail-lines";

const roadEnd = (trail: LngLat[] | null) => ({ lat: 37.001, lng: -119.001, name: "Road end", walkMeters: 200, kind: "road-end" as const, trail });
const mk = (id: string, access: Stop["access"]): Pick<Stop, "id" | "lat" | "lng" | "access"> => ({ id, lat: 37, lng: -119, access });

describe("trailLines", () => {
  it("gives a mapped road end its trail", () => {
    const trail: LngLat[] = [[-119.001, 37.001], [-119.0005, 37.0005], [-119, 37]];
    expect(trailLines([mk("a", roadEnd(trail))])).toEqual([{ id: "a", geometry: trail, mapped: true }]);
  });
  it("gives a road end without a trail the straight line, unmapped", () => {
    expect(trailLines([mk("a", roadEnd(null))])).toEqual([{ id: "a", geometry: [[-119.001, 37.001], [-119, 37]], mapped: false }]);
  });
  it("makes none for a lot or a stop without access", () => {
    const lot = { lat: 37.1, lng: -119.1, name: "Lot", walkMeters: 500 };
    expect(trailLines([mk("a", lot), mk("b", { ...lot, kind: "lot" }), mk("c", null)])).toEqual([]);
  });
  it("appends the stop when the trail does not end there", () => {
    const trail: LngLat[] = [[-119.001, 37.001], [-119.0005, 37.0005]];
    const [l] = trailLines([mk("a", roadEnd(trail))]);
    expect(l.geometry).toEqual([...trail, [-119, 37]]);
    expect(l.mapped).toBe(true);
  });
});
