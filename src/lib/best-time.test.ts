import { describe, expect, it } from "vitest";
import {
  classifyBestTime, computeArrivals, computeBestTimes, describeBestTime, estimateArrivals, getSunWindows, solarDayAnchor,
  type SunWindows,
} from "./best-time";

const TUNNEL_VIEW = { lat: 37.7156, lng: -119.6773 }; // Yosemite
const FRESNO = { name: "Fresno", lat: 36.74, lng: -119.79 };

function within2Min(actual: Date | null, expectedIso: string) {
  expect(actual).not.toBeNull();
  expect(Math.abs(actual!.getTime() - Date.parse(expectedIso))).toBeLessThan(120_000);
}

// Synthetic round-number windows keep the classification tests readable.
const W: SunWindows = {
  sunrise: new Date("2026-07-01T06:00:00Z"),
  goldenHourEnd: new Date("2026-07-01T07:00:00Z"),
  solarNoon: new Date("2026-07-01T13:00:00Z"),
  goldenHour: new Date("2026-07-01T19:00:00Z"),
  sunset: new Date("2026-07-01T20:00:00Z"),
  alwaysUp: false,
  alwaysDown: false,
};
const at = (hhmm: string) => new Date(`2026-07-01T${hhmm}:00Z`);

describe("solarDayAnchor", () => {
  it("is 12:00Z at Greenwich", () => {
    expect(solarDayAnchor("2026-12-21", 0).toISOString()).toBe("2026-12-21T12:00:00.000Z");
  });

  it("shifts by 4 minutes per degree of longitude", () => {
    expect(solarDayAnchor("2026-07-01", -120).toISOString()).toBe("2026-07-01T20:00:00.000Z");
  });
});

describe("getSunWindows", () => {
  it("matches known Yosemite times on 2026-07-01", () => {
    const w = getSunWindows(TUNNEL_VIEW.lat, TUNNEL_VIEW.lng, "2026-07-01");
    within2Min(w.sunrise, "2026-07-01T12:40:48Z"); // 5:40 AM PDT
    within2Min(w.solarNoon, "2026-07-01T20:02:42Z");
    within2Min(w.sunset, "2026-07-02T03:24:25Z"); // 8:24 PM PDT the same local day
  });

  it("flags polar night and polar day", () => {
    expect(getSunWindows(78.22, 15.65, "2026-12-21").alwaysDown).toBe(true);
    expect(getSunWindows(78.22, 15.65, "2026-06-21").alwaysUp).toBe(true);
  });
});

describe("classifyBestTime", () => {
  it("buckets arrival into sunrise / midday / golden hour / sunset", () => {
    expect(classifyBestTime(W, at("05:00"))).toEqual({ window: "sunrise", at: W.sunrise });
    expect(classifyBestTime(W, at("10:00"))).toEqual({ window: "midday", at: W.solarNoon });
    expect(classifyBestTime(W, at("19:30"))).toEqual({ window: "golden hour", at: W.goldenHour });
    expect(classifyBestTime(W, at("21:00"))).toEqual({ window: "sunset", at: W.sunset });
  });

  it("treats each boundary as the start of the next window", () => {
    expect(classifyBestTime(W, at("07:00"))!.window).toBe("midday");
    expect(classifyBestTime(W, at("19:00"))!.window).toBe("golden hour");
    expect(classifyBestTime(W, at("20:00"))!.window).toBe("sunset");
  });

  it("defaults to evening golden hour without an arrival estimate", () => {
    expect(classifyBestTime(W, null)).toEqual({ window: "golden hour", at: W.goldenHour });
  });

  it("handles polar night and polar day", () => {
    expect(classifyBestTime({ ...W, alwaysDown: true }, at("10:00"))).toBeNull();
    expect(classifyBestTime({ ...W, alwaysUp: true, sunrise: null, sunset: null }, at("10:00"))).toEqual({
      window: "midday",
      at: W.solarNoon,
    });
  });
});

describe("estimateArrivals", () => {
  it("departs at the first stop and accumulates leg durations (seconds)", () => {
    expect(estimateArrivals(at("06:00"), [3600, 1800], 3)).toEqual([at("06:00"), at("07:00"), at("07:30")]);
  });

  it("returns an empty list for no stops", () => {
    expect(estimateArrivals(at("06:00"), [], 0)).toEqual([]);
  });

  it("returns null when the legs don't line up with the stops", () => {
    expect(estimateArrivals(at("06:00"), [3600], 3)).toBeNull();
  });
});

describe("computeBestTimes", () => {
  const stops = [TUNNEL_VIEW, { lat: 37.75, lng: -119.6 }];

  it("returns one result per stop, defaulting to golden hour without legs", () => {
    const result = computeBestTimes({ plannedDate: "2026-07-01", stops }, null);
    expect(result).toHaveLength(2);
    expect(result[0]!.window).toBe("golden hour");
  });

  it("departs at sunrise from the first stop, so it is a sunrise shot", () => {
    const [first, second] = computeBestTimes({ plannedDate: "2026-07-01", stops }, [3600]);
    expect(first!.window).toBe("sunrise");
    expect(second!.window).toBe("midday"); // ~1 h after sunrise, after morning golden hour
  });

  it("uses the default for a single stop even if legs are given", () => {
    const [only] = computeBestTimes({ plannedDate: "2026-07-01", stops: [TUNNEL_VIEW] }, []);
    expect(only!.window).toBe("golden hour");
  });
});

describe("computeArrivals", () => {
  it("returns null entries without a usable route", () => {
    expect(computeArrivals({ plannedDate: "2026-07-01", stops: [TUNNEL_VIEW, FRESNO] }, null)).toEqual([null, null]);
  });

  it("returns the departure for the first stop and later arrivals after it", () => {
    const [a, b] = computeArrivals({ plannedDate: "2026-07-01", stops: [TUNNEL_VIEW, FRESNO] }, [3600]);
    expect(b!.getTime() - a!.getTime()).toBe(3600_000);
  });
});

describe("describeBestTime", () => {
  it("formats the label and clock time", () => {
    expect(describeBestTime({ window: "golden hour", at: at("19:45") }, "UTC")).toBe("Golden hour · 7:45 PM");
    expect(describeBestTime(null)).toBe("No daylight");
  });
});
