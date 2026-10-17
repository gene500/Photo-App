import { describe, expect, it } from "vitest";
import { buildItinerary, itineraryFileName, type ItineraryStopSource } from "./itinerary";

const stop = (over: Partial<ItineraryStopSource> = {}): ItineraryStopSource => ({
  name: "Spot",
  lat: 1,
  lng: 2,
  notes: null,
  lightPref: "any",
  arrival: null,
  ...over,
});

const base = {
  tripName: "Trip",
  plannedDate: "2026-10-16",
  departAt: null,
  totalDistanceM: null,
  totalDurationS: null,
  timeFormat: "12h" as const,
  distanceUnit: "km" as const,
};

const build = (stops: ItineraryStopSource[], extra: Partial<Parameters<typeof buildItinerary>[0]> = {}) =>
  buildItinerary({ ...base, stops, ...extra });

describe("buildItinerary", () => {
  it("numbers stops from 1 and formats arrivals", () => {
    const a = new Date(2026, 9, 16, 6, 30);
    const b = new Date(2026, 9, 16, 18, 5);
    const out = build([stop({ name: "A", arrival: a }), stop({ name: "B", arrival: b })]);
    expect(out.stops.map((s) => [s.index, s.name, s.arrival])).toEqual([
      [1, "A", "6:30 AM"],
      [2, "B", "6:05 PM"],
    ]);
    expect(build([stop({ arrival: a })], { timeFormat: "24h" }).stops[0].arrival).toBe("06:30");
  });

  it("says when the time is not set", () => {
    expect(build([stop()]).stops[0].arrival).toBe("Time not set");
  });

  it("describes the preferred light, none for any", () => {
    expect(build([stop({ lightPref: "golden" })]).stops[0].bestLight).toBe("Best at golden hour");
    expect(build([stop({ lightPref: "any" })]).stops[0].bestLight).toBeNull();
  });

  it("joins notes and shot notes with a blank line", () => {
    expect(build([stop({ notes: "Park here", shotNotes: "Wide lens" })]).stops[0].notes).toBe("Park here\n\nWide lens");
    expect(build([stop({ notes: "Park here", shotNotes: "  " })]).stops[0].notes).toBe("Park here");
    expect(build([stop({ notes: " ", shotNotes: "" })]).stops[0].notes).toBeNull();
  });

  it("writes weather in words with the warning", () => {
    const w = [{ text: "☀️ 21°", label: "Sunny, 21°C", warning: "Cloud likely" }, { text: "☁️ 9°" }, null];
    const out = build([stop(), stop(), stop()], { weather: w });
    expect(out.stops.map((s) => s.weather)).toEqual(["Sunny, 21°C. Cloud likely", "☁️ 9°", null]);
    expect(build([stop()]).stops[0].weather).toBeNull();
  });

  it("builds the route, start and date lines", () => {
    const out = build([stop()], { totalDistanceM: 120000, totalDurationS: 5400, departAt: new Date(2026, 9, 16, 5, 0) });
    expect(out.routeLine).toBe("120 km · 1 h 30 min");
    expect(out.startLine).toBe("Starts 5:00 AM");
    expect(out.dateLine).toBe("Planned for 2026-10-16");
    const bare = build([stop()], { totalDistanceM: 1000 });
    expect(bare.routeLine).toBeNull();
    expect(bare.startLine).toBeNull();
  });

  it("never prints undefined or null for a bare stop", () => {
    const text = JSON.stringify(build([stop()]).stops[0], (_k, v) => (v === null ? "" : v));
    expect(text).not.toMatch(/undefined|null/);
  });
});

describe("itineraryFileName", () => {
  it("slugs the trip name", () => {
    expect(itineraryFileName("Big Sur / 2026")).toBe("Big-Sur-2026-itinerary.pdf");
    expect(itineraryFileName("???")).toBe("trip-itinerary.pdf");
  });
});
