import { describe, expect, it, vi } from "vitest";
import { buildProfile, createTypicalLookup, profileToForecast, sameDayInYear, TYPICAL_TTL_MS, TYPICAL_YEARS } from "./typical-weather";

const week = (dayRain: number) => {
  const time: string[] = [];
  const cloud: number[] = [];
  const precipitation: number[] = [];
  const temperature_2m: number[] = [];
  for (const d of ["2025-07-01", "2025-07-02"]) {
    for (let h = 0; h < 24; h++) {
      time.push(`${d}T${String(h).padStart(2, "0")}:00`);
      cloud.push(h === 12 ? 40 : 10);
      precipitation.push(d === "2025-07-01" ? dayRain : 0);
      temperature_2m.push(h === 12 ? 25 : 15);
    }
  }
  return { utc_offset_seconds: -25200, hourly: { time, cloud_cover: cloud, precipitation, temperature_2m } };
};

describe("buildProfile", () => {
  it("averages by hour of day and counts wet days", () => {
    const p = buildProfile([week(0.5)])!; // day 1 totals 12 mm, day 2 none
    expect(p.cloud[12]).toBe(40);
    expect(p.temp[12]).toBe(25);
    expect(p.wetDayPct).toBe(50);
    expect(p.utcOffsetSeconds).toBe(-25200);
  });
  it("is null with no usable data", () => {
    expect(buildProfile([])).toBeNull();
    expect(buildProfile([{}, null, "x"])).toBeNull();
  });
});

describe("profileToForecast", () => {
  it("builds three typical days of hours marked typical", () => {
    const f = profileToForecast(buildProfile([week(0)])!, "2027-07-01");
    expect(f).toMatchObject({ available: true, typical: true });
    if (f.available) {
      expect(f.hours).toHaveLength(72);
      expect(f.hours[24 + 12]).toEqual({ time: "2027-07-01T12:00", cloudPct: 40, rainPct: 0, tempC: 25 });
    }
  });
});

describe("sameDayInYear", () => {
  it("moves the calendar day to another year", () => {
    expect(sameDayInYear("2027-07-01", 2025)).toBe("2025-07-01");
    expect(sameDayInYear("2028-02-29", 2025)).toBe("2025-03-01");
  });
});

describe("typical lookup", () => {
  const ok = () => new Response(JSON.stringify([week(0), week(0)]));
  it("makes one archive request per past year for all points, uses the fixed host, then serves from cache", async () => {
    const f = vi.fn(async () => ok());
    const lookup = createTypicalLookup({ fetchImpl: f as unknown as typeof fetch });
    const pts = [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }];
    const res = await lookup(pts, "2027-07-01", "2026-10-09");
    expect(res.every((r) => r.available && r.typical)).toBe(true);
    expect(f).toHaveBeenCalledTimes(TYPICAL_YEARS);
    const url = String((f.mock.calls[0] as unknown[])[0]);
    expect(url.startsWith("https://archive-api.open-meteo.com/v1/archive?")).toBe(true);
    expect(url).toContain("latitude=1.00%2C3.00");
    await lookup(pts, "2027-07-01", "2026-10-09");
    expect(f).toHaveBeenCalledTimes(TYPICAL_YEARS);
  });
  it("expires after a day and reports unavailable on failures without caching them", async () => {
    let t = 0;
    const f = vi.fn(async () => new Response("no", { status: 500 }));
    const lookup = createTypicalLookup({ fetchImpl: f as unknown as typeof fetch, now: () => t });
    expect((await lookup([{ lat: 1, lng: 2 }], "2027-07-01", "2026-10-09"))[0]).toEqual({ available: false, reason: "unavailable" });
    await lookup([{ lat: 1, lng: 2 }], "2027-07-01", "2026-10-09");
    expect(f).toHaveBeenCalledTimes(TYPICAL_YEARS * 2);
    f.mockImplementation(async () => ok1());
    function ok1() { return new Response(JSON.stringify(week(0))); }
    await lookup([{ lat: 1, lng: 2 }], "2027-07-01", "2026-10-09");
    const calls = f.mock.calls.length;
    t += TYPICAL_TTL_MS + 1;
    await lookup([{ lat: 1, lng: 2 }], "2027-07-01", "2026-10-09");
    expect(f.mock.calls.length).toBe(calls + TYPICAL_YEARS);
  });
});
