// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "../../../tests/helpers/memory-storage";
import { resetPlacePhotoCache } from "@/lib/place-photo-cache";

// Render-count probes: StopPhoto is rendered once inside every Stops row, useHike once inside every My trip row.
const renders = vi.hoisted(() => ({ photo: new Map<string, number>(), hike: new Map<string, number>() }));
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

vi.mock("@/lib/api-client", () => ({
  api: {
    directions: vi.fn(), addStop: vi.fn(), suggestions: vi.fn(), reorderStops: vi.fn(), resolveAccess: vi.fn(),
    updateStop: vi.fn(), uploadPhoto: vi.fn(), deleteStop: vi.fn(), updateTrip: vi.fn(), reverseGeocode: vi.fn(), suggestionPopularity: vi.fn(), placePhoto: vi.fn(async () => ({ photo: null })), geocode: vi.fn(), optimizeOrder: vi.fn(), locate: vi.fn(async () => ({ area: null })),
  },
}));
vi.mock("./MapView", () => ({
  MapView: (p: import("./map-types").MapViewProps) => (
    <div>
      <button type="button" onClick={() => p.stops[0] && p.onStopClick(p.stops[0].id)}>click first marker</button>
      <button type="button" onClick={() => p.stops[0] && p.onStopMove?.(p.stops[0].id, { lat: 38, lng: -118 })}>drag first marker</button>
    </div>
  ),
}));
vi.mock("./SearchBar", () => ({ SearchBar: () => null }));
vi.mock("./StopPhoto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./StopPhoto")>();
  return { ...actual, StopPhoto: (p: Parameters<typeof actual.StopPhoto>[0]) => { bump(renders.photo, p.stop.name); return actual.StopPhoto(p); } };
});
vi.mock("@/lib/use-hike", () => ({ useHike: (id: string) => { bump(renders.hike, id); return null; }, useHikes: () => new Map() }));
vi.mock("@/lib/itinerary-download", () => ({
  createItineraryPdf: vi.fn(), loadWeatherLines: vi.fn(), saveBlob: vi.fn(), mapTokenFromEnv: vi.fn(() => null),
}));
import { api } from "@/lib/api-client";
import type { Stop } from "@/lib/types";
import { TripEditor } from "./TripEditor";

const mk = (id: string, order: number, lat: number, lng: number): Stop => ({
  id, tripId: "t1", order, name: `Stop ${id}`, lat, lng, notes: null, source: "manual", photoUrl: null, visited: false, lightPref: "any", priority: "normal", dwellMinutes: 30, shotNotes: null, shotChecklist: [], access: null, accessResolvedAt: null,
});
const stops = [mk("a", 0, 36.74, -119.79), mk("b", 1, 37.96, -119.12), mk("c", 2, 38.5, -119.0)];
const trip = { id: "t1", name: "Sierra loop", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops };
const settle = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("TripEditor list rows", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.sessionStorage.clear();
    installMemoryStorage();
    vi.clearAllMocks();
    resetPlacePhotoCache();
    renders.photo.clear();
    renders.hike.clear();
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [] });
    vi.mocked(api.locate).mockResolvedValue({ area: null });
    vi.mocked(api.directions).mockResolvedValue({ route: { geometry: [[-119.79, 36.74], [-119.12, 37.96]], legs: [], distance: 1, duration: 1 } });
    vi.mocked(api.updateStop).mockImplementation(async (_id, patch) => ({ stop: { ...stops[0], ...patch } }));
  });

  it("Stops rows skip an unrelated editor render and still update with their own stop", async () => {
    render(<TripEditor initialTrip={trip} />);
    await settle(1000);
    const before = new Map(renders.photo);
    expect(before.get("Stop a")).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "click first marker" })); // opens the stop card: editor state only
    await settle(1000);
    expect(screen.getAllByText(/Stop a/).length).toBeGreaterThan(1); // the card now shows it beside the row
    expect(new Map(renders.photo)).toEqual(before);
    await userEvent.click(screen.getByRole("button", { name: "drag first marker" })); // stop a moves
    await settle(1000);
    expect(renders.photo.get("Stop a")).toBeGreaterThan(before.get("Stop a")!);
    expect(renders.photo.get("Stop b")).toBe(before.get("Stop b"));
    expect(renders.photo.get("Stop c")).toBe(before.get("Stop c"));
  });

  it("My trip rows skip an unrelated editor render and still update with their own stop", async () => {
    render(<TripEditor initialTrip={trip} />);
    await userEvent.click(screen.getByRole("tab", { name: "My trip" }));
    await settle(1000);
    const before = new Map(renders.hike);
    expect(before.get("a")).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "click first marker" }));
    await settle(1000);
    expect(new Map(renders.hike)).toEqual(before);
    await userEvent.click(screen.getByRole("button", { name: "drag first marker" }));
    await settle(1000);
    expect(renders.hike.get("a")).toBeGreaterThan(before.get("a")!);
    // (b and c may re-render here: moving a recomputes the arrival times they receive.)
  });
});
