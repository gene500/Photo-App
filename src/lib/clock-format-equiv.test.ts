import { afterEach, describe, expect, it } from "vitest";
import { getTimes } from "suncalc";
import { formatClock, getSunWindows, solarDayAnchor } from "./best-time";
import { formatDateOnly, formatInstantDate } from "./dates";

const ZONES = [undefined, "UTC", "America/Los_Angeles", "America/New_York", "Europe/London", "Asia/Kolkata", "Asia/Tokyo", "Australia/Lord_Howe", "Pacific/Auckland", "Pacific/Kiritimati", "America/St_Johns"];
const FORMATS = ["auto", "12h", "24h"] as const;
const oldClock = (date: Date, timeZone: string | undefined, f: (typeof FORMATS)[number]) =>
  date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone, hourCycle: f === "24h" ? "h23" : f === "12h" ? "h12" : undefined });

describe("formatClock matches toLocaleTimeString", () => {
  it("for a grid of zones, formats and instants (twice, so the cached formatter is used)", () => {
    const base = Date.UTC(2026, 2, 7, 0, 0);
    for (let pass = 0; pass < 2; pass++)
      for (const tz of ZONES) for (const f of FORMATS) for (let h = 0; h < 24 * 3; h++) for (const m of [0, 5, 59]) {
        const d = new Date(base + h * 3_600_000 + m * 60_000);
        expect(formatClock(d, tz, f)).toBe(oldClock(d, tz, f));
      }
  });
  it("answers Invalid Date for an invalid date and still throws for a bad zone", () => {
    expect(formatClock(new Date(NaN), "UTC")).toBe(new Date(NaN).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }));
    expect(() => formatClock(new Date(0), "Not/AZone")).toThrow(RangeError);
  });
  describe("default zone follows process.env.TZ", () => {
    const real = process.env.TZ;
    afterEach(() => { if (real === undefined) delete process.env.TZ; else process.env.TZ = real; });
    it("does not keep a stale zone", () => {
      const d = new Date(Date.UTC(2026, 6, 1, 12, 0));
      for (const tz of ["America/Los_Angeles", "Asia/Tokyo", "UTC", "America/Los_Angeles"]) {
        process.env.TZ = tz;
        expect(formatClock(d, undefined, "24h")).toBe(oldClock(d, undefined, "24h"));
        expect(formatInstantDate(d.toISOString())).toBe(new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(d));
      }
    });
    it("tells an unset TZ from an empty one (empty means UTC)", () => {
      const d = new Date(Date.UTC(2026, 6, 1, 22, 13));
      delete process.env.TZ;
      expect(formatClock(d, undefined, "12h")).toBe(oldClock(d, undefined, "12h"));
      process.env.TZ = "";
      expect(formatClock(d, undefined, "12h")).toBe(oldClock(d, undefined, "12h"));
      delete process.env.TZ;
      expect(formatClock(d, undefined, "12h")).toBe(oldClock(d, undefined, "12h"));
    });
  });
  it("formatDateOnly is unchanged", () => {
    expect(formatDateOnly("2026-11-20")).toBe("Nov 20, 2026");
  });
});

describe("getSunWindows memo", () => {
  it("equals suncalc for a grid, hands out independent Dates, and survives eviction", () => {
    for (const [lat, lng] of [[36.74, -119.79], [78.2, 15.6], [-77.8, 166.7], [0, 0], [64.8, -147.7]]) {
      for (const date of ["2026-06-21", "2026-12-21", "2026-03-07"]) {
        const t = getTimes(solarDayAnchor(date, lng), lat, lng);
        for (let i = 0; i < 2; i++) {
          const w = getSunWindows(lat, lng, date);
          expect(w).toEqual({ sunrise: t.sunrise, goldenHourEnd: t.goldenHourEnd, solarNoon: t.solarNoon, goldenHour: t.goldenHour, sunset: t.sunset, alwaysUp: t.alwaysUp === true, alwaysDown: t.alwaysDown === true });
          w.solarNoon.setFullYear(1999); // a caller mutating its copy must not leak into the next answer
          w.sunrise?.setFullYear(1999);
        }
      }
    }
    for (let i = 0; i < 700; i++) getSunWindows(i / 10, 10, "2026-06-21");
    const again = getSunWindows(36.74, -119.79, "2026-06-21");
    expect(again.solarNoon).toEqual(getTimes(solarDayAnchor("2026-06-21", -119.79), 36.74, -119.79).solarNoon);
  });
});
