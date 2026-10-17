import { describe, expect, it } from "vitest";
import { solarDayAnchor } from "./best-time";
import { azimuthToBearing, compassWord, getSkyInfo, moonPhaseName } from "./sky";

describe("azimuthToBearing", () => {
  it("converts suncalc's south-based azimuth to a compass bearing", () => {
    expect(azimuthToBearing(0)).toBeCloseTo(180);
    expect(azimuthToBearing(Math.PI / 2)).toBeCloseTo(270);
    expect(azimuthToBearing(-Math.PI / 2)).toBeCloseTo(90);
    expect(azimuthToBearing(Math.PI)).toBeCloseTo(0);
  });
});

describe("compassWord", () => {
  it("names the 16 compass points", () => {
    expect(compassWord(0)).toBe("N");
    expect(compassWord(72)).toBe("ENE");
    expect(compassWord(90)).toBe("E");
    expect(compassWord(288)).toBe("WNW");
    expect(compassWord(348)).toBe("NNW");
    expect(compassWord(359)).toBe("N");
  });
});

describe("moonPhaseName", () => {
  it("buckets the phase into eight names", () => {
    expect(moonPhaseName(0)).toBe("new moon");
    expect(moonPhaseName(0.125)).toBe("waxing crescent");
    expect(moonPhaseName(0.25)).toBe("first quarter");
    expect(moonPhaseName(0.375)).toBe("waxing gibbous");
    expect(moonPhaseName(0.5)).toBe("full moon");
    expect(moonPhaseName(0.625)).toBe("waning gibbous");
    expect(moonPhaseName(0.75)).toBe("last quarter");
    expect(moonPhaseName(0.875)).toBe("waning crescent");
    expect(moonPhaseName(0.99)).toBe("new moon");
  });
});

describe("getSkyInfo", () => {
  it("rises due east and sets due west at the equinox", () => {
    const s = getSkyInfo(0, 0, "2026-03-20");
    expect(Math.abs(s.sunrise!.bearing - 90)).toBeLessThan(2);
    expect(Math.abs(s.sunset!.bearing - 270)).toBeLessThan(2);
  });

  it("swings north in June and south in December", () => {
    const jun = getSkyInfo(37.7156, -119.6773, "2026-06-21");
    expect(Math.abs(jun.sunrise!.bearing - 60)).toBeLessThan(2);
    expect(Math.abs(jun.sunset!.bearing - 300)).toBeLessThan(2);
    const dec = getSkyInfo(37.7156, -119.6773, "2026-12-21");
    expect(Math.abs(dec.sunrise!.bearing - 120)).toBeLessThan(2);
    expect(Math.abs(dec.sunset!.bearing - 240)).toBeLessThan(2);
  });

  it("reports the moon phase and illumination", () => {
    const nw = getSkyInfo(0, 0, "2000-01-06").moon;
    expect(nw.phase).toBe("new moon");
    expect(nw.illuminationPct).toBeLessThan(5);
    const full = getSkyInfo(0, 0, "2000-01-21").moon;
    expect(full.phase).toBe("full moon");
    expect(full.illuminationPct).toBeGreaterThan(95);
  });

  it("flags polar day and polar night with no sun events", () => {
    const day = getSkyInfo(78, 15, "2026-06-21");
    expect(day.alwaysUp).toBe(true);
    expect(day.sunrise).toBeNull();
    expect(day.sunset).toBeNull();
    const night = getSkyInfo(78, 15, "2026-12-21");
    expect(night.alwaysDown).toBe(true);
    expect(night.sunrise).toBeNull();
    expect(night.sunset).toBeNull();
  });

  it.each([-170, 170])("keeps events inside the local solar day at lng %i", (lng) => {
    const s = getSkyInfo(40, lng, "2026-07-01");
    const anchor = solarDayAnchor("2026-07-01", lng).getTime();
    const within = (d: Date) => Math.abs(d.getTime() - anchor) <= 12 * 3600_000;
    expect(within(s.sunrise!.at)).toBe(true);
    expect(within(s.sunset!.at)).toBe(true);
    if (s.moon.rise) expect(within(s.moon.rise)).toBe(true);
  });
});
