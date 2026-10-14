// @vitest-environment jsdom
// Repeatable perceived-speed benchmark: virtual clock + mocked API with realistic latencies. No network.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPlacePhotoCache } from "@/lib/place-photo-cache";

const LAT = { directions: 400, suggestions: 800, popularity: 300, photo: 200 };
const N = 30;
const RUNS = 10;

vi.mock("@/lib/api-client", () => ({
  api: { directions: vi.fn(), suggestions: vi.fn(), suggestionPopularity: vi.fn(), placePhoto: vi.fn(), weatherBatch: vi.fn(), weather: vi.fn(), addStop: vi.fn(), reorderStops: vi.fn(), updateStop: vi.fn(), uploadPhoto: vi.fn(), deleteStop: vi.fn(), updateTrip: vi.fn(), reverseGeocode: vi.fn(), geocode: vi.fn(), optimizeOrder: vi.fn() },
}));
vi.mock("./MapView", () => ({ MapView: () => <div /> }));
vi.mock("./SearchBar", () => ({ SearchBar: () => <div /> }));
import { api } from "@/lib/api-client";
import type { Stop, TripWithStops } from "@/lib/types";
import { TripEditor } from "./TripEditor";

const stop = (id: string, order: number, lat: number, lng: number): Stop => ({ id, tripId: "t", order, name: id, lat, lng, notes: null, source: "manual", photoUrl: null, visited: false, lightPref: "any", dwellMinutes: 30, shotNotes: null, shotChecklist: [] });
const trip = (stops: Stop[]): TripWithStops => ({ id: "t", name: "T", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops });
const found = Array.from({ length: N }, (_, i) => ({ osmId: `node/${i}`, name: `Spot ${i}`, lat: 37.7 + i / 100, lng: -119.7, kind: "viewpoint" as const }));
const later = <T,>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const cards = () => screen.queryAllByTestId("suggestion-card").length;

async function measure(setup: () => Promise<void> | void) {
  const t0 = Date.now();
  await setup();
  let first = -1, full = -1;
  for (let i = 0; i < 400 && full < 0; i++) {
    if (first < 0 && cards() > 0) first = Date.now() - t0;
    if (cards() >= N) full = Date.now() - t0;
    if (full < 0) await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  }
  return { first, full };
}

describe("suggestions perceived latency (benchmark)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPlacePhotoCache();
    vi.mocked(api.directions).mockImplementation(() => later(LAT.directions, { route: { geometry: [[-119.79, 36.74], [-119.12, 37.96]] as [number, number][], legs: [{ distance: 1e5, duration: 3600 }], distance: 1e5, duration: 3600 } }));
    vi.mocked(api.suggestions).mockImplementation(() => later(LAT.suggestions, { suggestions: found }));
    vi.mocked(api.suggestionPopularity).mockImplementation((places) => later(LAT.popularity, { counts: places.map(() => 1) }));
    vi.mocked(api.placePhoto).mockImplementation(() => later(LAT.photo, { photo: null }));
    vi.mocked(api.weatherBatch).mockImplementation(async (_d, pts) => ({ forecasts: pts.map(() => ({ available: false, reason: "unavailable" }) as never) }));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  it("measures time to first card and to all cards", async () => {
    const k1 = "single stop (from mount)";
    const k2 = "route, click Find 1.5s after route shows";
    const res: Record<string, { first: number[]; full: number[] }> = { [k1]: { first: [], full: [] }, [k2]: { first: [], full: [] } };
    for (let r = 0; r < RUNS; r++) {
      resetPlacePhotoCache();
      let m = await measure(() => { render(<TripEditor initialTrip={trip([stop("a", 0, 36.74, -119.79)])} />); fireEvent.click(screen.getByRole("tab", { name: /Suggestions/ })); });
      res[k1].first.push(m.first); res[k1].full.push(m.full);
      cleanup();
      resetPlacePhotoCache();
      render(<TripEditor initialTrip={trip([stop("a", 0, 36.74, -119.79), stop("b", 1, 37.96, -119.12)])} />);
      fireEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
      for (let t = 0; t < LAT.directions + 1500; t += 10) await act(async () => { await vi.advanceTimersByTimeAsync(10); }); // route loads, user thinks
      m = await measure(() => { fireEvent.click(screen.getByRole("button", { name: "Find photo spots" })); });
      res[k2].first.push(m.first); res[k2].full.push(m.full);
      cleanup();
    }
    for (const [k, v] of Object.entries(res)) console.log(`BENCH ${k}: first card median ${median(v.first)}ms, all ${N} cards median ${median(v.full)}ms (n=${RUNS})`);
    for (const v of Object.values(res)) expect(v.first.every((x) => x >= 0) && v.full.every((x) => x >= 0)).toBe(true);
  }, 60_000);
});
