import { describe, expect, it } from "vitest";
import {
  addDays, describeWeather, forecastSpan, hourInstant, inForecastRange, lightQuality, parseOpenMeteo, summarizeAt, weatherLabel,
} from "./weather";
import type { WeatherForecast } from "./types";

// Shape of a real Open-Meteo response for 37.77,-122.42 on 2026-07-01 with timezone=auto (trimmed to a few hours).
const PACIFIC = {
  latitude: 37.78, longitude: -122.42, generationtime_ms: 0.06, utc_offset_seconds: -25200,
  timezone: "America/Los_Angeles", timezone_abbreviation: "GMT-7", elevation: 18,
  hourly_units: { time: "iso8601", cloud_cover: "%", precipitation_probability: "%", temperature_2m: "°C" },
  hourly: {
    time: ["2026-07-01T17:00", "2026-07-01T18:00", "2026-07-01T19:00", "2026-07-01T20:00", "2026-07-01T21:00"],
    cloud_cover: [10, 15, 30, 65, 95],
    precipitation_probability: [0, 5, 15, 40, 70],
    temperature_2m: [19.1, 18.4, 17.2, 15.9, 14.8],
  },
};

function forecast(): Extract<WeatherForecast, { available: true }> {
  const f = parseOpenMeteo(PACIFIC);
  if (!f.available) throw new Error("fixture should parse");
  return f;
}

describe("parseOpenMeteo", () => {
  it("parses a real-shaped response", () => {
    const f = forecast();
    expect(f.utcOffsetSeconds).toBe(-25200);
    expect(f.hours).toHaveLength(5);
    expect(f.hours[2]).toEqual({ time: "2026-07-01T19:00", cloudPct: 30, rainPct: 15, tempC: 17.2 });
  });

  it("keeps null values as null and drops malformed times", () => {
    const f = parseOpenMeteo({
      utc_offset_seconds: 0,
      hourly: { time: ["2026-07-01T10:00", "nonsense"], cloud_cover: [null, 5], precipitation_probability: [], temperature_2m: [1, 2] },
    });
    expect(f).toEqual({ available: true, utcOffsetSeconds: 0, hours: [{ time: "2026-07-01T10:00", cloudPct: null, rainPct: null, tempC: 1 }] });
  });

  it.each([null, "x", {}, { utc_offset_seconds: 0 }, { utc_offset_seconds: "0", hourly: { time: [] } }, { utc_offset_seconds: 0, hourly: { time: [] } }])(
    "treats %j as unavailable",
    (bad) => expect(parseOpenMeteo(bad)).toEqual({ available: false, reason: "unavailable" }),
  );
});

describe("hourInstant (local forecast time -> instant)", () => {
  it("subtracts the UTC offset: 7 PM PDT is 02:00 UTC the next day", () => {
    expect(new Date(hourInstant("2026-07-01T19:00", -25200)).toISOString()).toBe("2026-07-02T02:00:00.000Z");
  });
  it("handles a positive, half-hour offset: 6 AM IST is 00:30 UTC", () => {
    expect(new Date(hourInstant("2026-07-01T06:00", 19800)).toISOString()).toBe("2026-07-01T00:30:00.000Z");
  });
  it("is the identity at UTC", () => {
    expect(new Date(hourInstant("2026-07-01T06:00", 0)).toISOString()).toBe("2026-07-01T06:00:00.000Z");
  });
  it("is NaN for garbage", () => expect(hourInstant("soon", 0)).toBeNaN());
});

describe("summarizeAt across a non-UTC zone", () => {
  it("picks the local 19:00 hour for the matching UTC instant, not the 19:00 UTC hour", () => {
    const s = summarizeAt(forecast(), "2026-07-02T02:10:00Z"); // 7:10 PM PDT
    expect(s).toEqual({ cloudPct: 30, rainPct: 15, tempC: 17.2, label: "Partly cloudy" });
  });
  it("rounds to the nearest hour", () => {
    expect(summarizeAt(forecast(), "2026-07-02T03:40:00Z")?.cloudPct).toBe(95); // 8:40 PM PDT -> 21:00
    expect(summarizeAt(forecast(), "2026-07-02T03:20:00Z")?.cloudPct).toBe(65); // 8:20 PM PDT -> 20:00
  });
  it("works in a zone ahead of UTC", () => {
    const f: Extract<WeatherForecast, { available: true }> = {
      available: true,
      utcOffsetSeconds: 19800,
      hours: [{ time: "2026-07-01T06:00", cloudPct: 5, rainPct: 0, tempC: 24 }],
    };
    expect(summarizeAt(f, "2026-06-30T00:30:00Z")).toBeNull(); // wrong day: a day before
    expect(summarizeAt(f, "2026-07-01T00:30:00Z")?.label).toBe("Clear");
  });
  it("returns null when no hour is within 90 minutes, or the instant is invalid", () => {
    expect(summarizeAt(forecast(), "2026-07-02T06:00:00Z")).toBeNull();
    expect(summarizeAt(forecast(), "nope")).toBeNull();
  });
  it("skips hours with no cloud data and treats missing rain as 0", () => {
    const f: Extract<WeatherForecast, { available: true }> = {
      available: true,
      utcOffsetSeconds: 0,
      hours: [
        { time: "2026-07-01T10:00", cloudPct: null, rainPct: null, tempC: null },
        { time: "2026-07-01T11:00", cloudPct: 50, rainPct: null, tempC: null },
      ],
    };
    expect(summarizeAt(f, "2026-07-01T10:00:00Z")).toEqual({ cloudPct: 50, rainPct: 0, tempC: null, label: "Mostly cloudy" });
  });
});

describe("labels and light quality", () => {
  it.each([
    [0, 0, "Clear"], [19, 0, "Clear"], [20, 0, "Partly cloudy"], [49, 10, "Partly cloudy"], [50, 0, "Mostly cloudy"],
    [79, 49, "Mostly cloudy"], [80, 0, "Overcast"], [100, 0, "Overcast"], [5, 50, "Rain likely"], [100, 80, "Rain likely"],
  ] as const)("cloud %i%% rain %i%% -> %s", (c, r, label) => expect(weatherLabel(c, r)).toBe(label));

  it("rates light for a preference", () => {
    expect(lightQuality("sunset", { cloudPct: 10, rainPct: 0 })).toBe("good");
    expect(lightQuality("golden", { cloudPct: 40, rainPct: 10 })).toBe("good");
    expect(lightQuality("sunrise", { cloudPct: 60, rainPct: 10 })).toBe("fair");
    expect(lightQuality("sunset", { cloudPct: 90, rainPct: 0 })).toBe("poor");
    expect(lightQuality("sunset", { cloudPct: 10, rainPct: 60 })).toBe("poor");
    expect(lightQuality("any", { cloudPct: 10, rainPct: 0 })).toBeNull();
  });

  it("describes the weather for a hint", () => {
    expect(describeWeather({ cloudPct: 30, rainPct: 15, tempC: 1, label: "Partly cloudy" })).toBe("partly cloudy, 15% rain");
    expect(describeWeather({ cloudPct: 30, rainPct: 70, tempC: 1, label: "Rain likely" })).toBe("rain likely (70%)");
  });
});

describe("inForecastRange", () => {
  it("covers yesterday (UTC runs ahead of the Americas) through today + 15 only", () => {
    expect(inForecastRange("2026-10-07", "2026-10-07")).toBe(true);
    expect(inForecastRange("2026-10-22", "2026-10-07")).toBe(true);
    expect(inForecastRange("2026-10-23", "2026-10-07")).toBe(false);
    expect(inForecastRange("2026-10-06", "2026-10-07")).toBe(true);
    expect(inForecastRange("2026-10-05", "2026-10-07")).toBe(false);
  });
});

describe("forecastSpan", () => {
  it("asks for the day before through the day after", () => {
    expect(forecastSpan("2026-10-12", "2026-10-07")).toEqual({ start: "2026-10-11", end: "2026-10-13" });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("is clamped to yesterday..today+15", () => {
    expect(forecastSpan("2026-10-07", "2026-10-07")).toEqual({ start: "2026-10-06", end: "2026-10-08" });
    expect(forecastSpan("2026-10-06", "2026-10-07")).toEqual({ start: "2026-10-06", end: "2026-10-07" });
    expect(forecastSpan("2026-10-22", "2026-10-07")).toEqual({ start: "2026-10-21", end: "2026-10-22" });
  });
});
