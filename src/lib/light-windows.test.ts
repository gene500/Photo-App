import { describe, expect, it } from "vitest";
import type { SunWindows } from "./best-time";
import { lightWindows, windowMissMinutes } from "./light-windows";

const at = (hhmm: string) => new Date(`2026-07-01T${hhmm}:00Z`);
const SUN: SunWindows = {
  sunrise: at("06:00"),
  goldenHourEnd: at("07:00"),
  solarNoon: at("13:00"),
  goldenHour: at("19:00"),
  sunset: at("20:00"),
  alwaysUp: false,
  alwaysDown: false,
};

describe("lightWindows", () => {
  it("sunrise runs from 20 min before sunrise to the end of golden hour", () => {
    expect(lightWindows("sunrise", SUN)).toEqual([[at("05:40"), at("07:00")]]);
  });
  it("sunset runs from golden hour to 20 min after sunset", () => {
    expect(lightWindows("sunset", SUN)).toEqual([[at("19:00"), at("20:20")]]);
  });
  it("golden is both", () => {
    expect(lightWindows("golden", SUN)).toHaveLength(2);
  });
  it("any is unconstrained", () => {
    expect(lightWindows("any", SUN)).toEqual([]);
  });
  it("has no constraint when the sun times are missing (polar)", () => {
    const polar = { ...SUN, sunrise: null, goldenHourEnd: null, goldenHour: null, sunset: null, alwaysUp: true };
    expect(lightWindows("sunrise", polar)).toEqual([]);
    expect(lightWindows("golden", polar)).toEqual([]);
  });
});

describe("windowMissMinutes", () => {
  const w = lightWindows("sunset", SUN);
  it("is 0 when the visit overlaps the window", () => {
    expect(windowMissMinutes(at("19:30"), 30, w)).toBe(0);
    expect(windowMissMinutes(at("18:40"), 30, w)).toBe(0); // still there when it opens
    expect(windowMissMinutes(at("20:10"), 60, w)).toBe(0); // arrives before it closes
  });
  it("is 0 with no windows", () => {
    expect(windowMissMinutes(at("03:00"), 30, [])).toBe(0);
  });
  it("counts minutes before the window opens", () => {
    expect(windowMissMinutes(at("17:00"), 30, w)).toBe(90);
  });
  it("counts minutes after the window has closed", () => {
    expect(windowMissMinutes(at("21:00"), 30, w)).toBe(40);
  });
  it("uses the nearest of several windows", () => {
    expect(windowMissMinutes(at("10:00"), 0, lightWindows("golden", SUN))).toBe(180);
  });
});
