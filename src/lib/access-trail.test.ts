import { describe, expect, it } from "vitest";
import { ACCESS_TRAIL_MAX_CHARS, ACCESS_TRAIL_MAX_POINTS, isLngLatList, parseAccessTrail, serializeAccessTrail } from "./access-trail";
import type { LngLat } from "./types";

const pts = (n: number): LngLat[] => Array.from({ length: n }, (_, i) => [-109 - i / 1000, 38 + i / 1000]);

describe("access trail", () => {
  it("parses a valid trail", () => {
    expect(parseAccessTrail("[[ -109.5,38.7],[-109.51,38.71]]")).toEqual([[-109.5, 38.7], [-109.51, 38.71]]);
  });
  it("returns null for bad input", () => {
    expect(parseAccessTrail("not json")).toBeNull();
    expect(parseAccessTrail("[[1,2]]")).toBeNull();
    expect(parseAccessTrail("[[200,0],[0,0]]")).toBeNull();
    expect(parseAccessTrail(JSON.stringify(pts(121)))).toBeNull();
    expect(parseAccessTrail(null)).toBeNull();
  });
  it("accepts an array and checks it with isLngLatList", () => {
    expect(parseAccessTrail(pts(3))).toHaveLength(3);
    expect(isLngLatList([[1, 2], [3, 4]])).toBe(true);
    expect(isLngLatList([[1, 2], [3, "x"]])).toBe(false);
    expect(isLngLatList("x")).toBe(false);
  });
  it("serialize caps points and chars, and rounds to 5 decimals", () => {
    expect(ACCESS_TRAIL_MAX_POINTS).toBe(120);
    expect(ACCESS_TRAIL_MAX_CHARS).toBe(4000);
    expect(serializeAccessTrail(pts(121))).toBeNull();
    expect(serializeAccessTrail(null)).toBeNull();
    const t: LngLat[] = Array.from({ length: 100 }, (_, i) => [-109.123456789 - i * 0.0001, 38.987654321 + i * 0.0001]);
    const s = serializeAccessTrail(t)!;
    expect(s.length).toBeLessThanOrEqual(4000);
    expect(JSON.parse(s)[0]).toEqual([-109.12346, 38.98765]);
  });
});
