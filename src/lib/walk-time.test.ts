import { describe, expect, it } from "vitest";
import { hasWalkLength, MAX_WALK_MINUTES, stopWalkMinutes, walkMinutes, walkMs, WALK_METERS_PER_MINUTE } from "./walk-time";

describe("walkMinutes", () => {
  it("is 0 for no, zero, negative or non-finite walks", () => {
    for (const v of [null, undefined, 0, -5, NaN, Infinity, -Infinity]) expect(walkMinutes(v)).toBe(0);
  });
  it("rounds one-way minutes up to a multiple of 5", () => {
    expect(walkMinutes(1)).toBe(5);
    expect(walkMinutes(333)).toBe(5); // 4.995 min
    expect(walkMinutes(334)).toBe(10); // 5.01 min
    expect(walkMinutes(400)).toBe(10); // 6 min
    expect(walkMinutes(1000)).toBe(15); // exactly 15 min stays 15
    expect(walkMinutes(1920)).toBe(30); // 28.8 min
    expect(walkMinutes(1931)).toBe(30); // 28.97
    expect(walkMinutes(2000)).toBe(30);
    expect(walkMinutes(2001)).toBe(35);
  });
  it("uses 4 km/h and caps a huge walk", () => {
    expect(WALK_METERS_PER_MINUTE).toBeCloseTo(66.667, 3);
    expect(walkMinutes(1e12)).toBe(MAX_WALK_MINUTES);
  });
});

describe("walkMs and stopWalkMinutes", () => {
  it("converts minutes to ms, 0 for missing", () => {
    expect(walkMs(30)).toBe(1_800_000);
    expect(walkMs(undefined)).toBe(0);
    expect(walkMs(NaN)).toBe(0);
  });
  it("reads a stop's saved walk", () => {
    expect(stopWalkMinutes({ access: { walkMeters: 1920 } })).toBe(30);
    expect(stopWalkMinutes({ access: { walkMeters: null } })).toBe(0);
    expect(stopWalkMinutes({ access: null })).toBe(0);
    expect(stopWalkMinutes({})).toBe(0);
  });
});

describe("hasWalkLength", () => {
  it("is true only for a positive finite number", () => {
    expect([1, 0.5].map(hasWalkLength)).toEqual([true, true]);
    expect([0, -3, NaN, Infinity, null, undefined].map(hasWalkLength)).toEqual([false, false, false, false, false, false]);
  });
});
