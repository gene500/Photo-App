// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "../../../tests/helpers/memory-storage";
import { resetHikeCache } from "@/lib/hike-cache";

vi.mock("@/lib/api-client", () => ({
  api: {
    directions: vi.fn(() => new Promise(() => {})), suggestions: vi.fn(async () => ({ suggestions: [] })), suggestionPopularity: vi.fn(), placePhoto: vi.fn(async () => ({ photo: null })),
    locate: vi.fn(async () => ({ area: null })), reverseGeocode: vi.fn(), updateStop: vi.fn(), hike: vi.fn(),
  },
}));
vi.mock("./MapView", () => ({
  MapView: (p: import("./map-types").MapViewProps) => (
    <div>
      <button type="button" onClick={() => p.stops[0] && p.onStopClick(p.stops[0].id)}>click first marker</button>
      <button type="button" onClick={() => p.stops[1] && p.onStopClick(p.stops[1].id)}>click second marker</button>
      <span data-testid="map-hikes">{(p.hikes ?? []).map((h) => `${h.id}:${h.geometry.length}`).join(",")}</span>
      <span data-testid="map-route">{p.routeGeometry ? "route" : "none"}</span>
    </div>
  ),
}));
vi.mock("./SearchBar", () => ({ SearchBar: () => null }));
import { api } from "@/lib/api-client";
import type { Stop, TripWithStops } from "@/lib/types";
import { TripEditor } from "./TripEditor";

const stop = (over: Partial<Stop>): Stop => ({
  id: "s1", tripId: "t1", order: 0, name: "Pin", lat: 37, lng: -119.5, notes: null, source: "manual", photoUrl: null, visited: false, lightPref: "any", priority: "normal", dwellMinutes: 30, shotNotes: null, shotChecklist: [], ...over,
});
const trip: TripWithStops = { id: "t1", name: "Trip", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [stop({ id: "a", name: "Arch" }), stop({ id: "b", name: "Plain", order: 1, lat: 36.2, lng: -120.5 })] };
const HIKE = { distanceMeters: 1931, geometry: [[-119.52, 36.99], [-119.51, 36.995], [-119.5, 37]] as [number, number][], source: "osm" as const, attribution: "x" };

describe("TripEditor hike line", () => {
  beforeEach(() => {
    installMemoryStorage();
    resetHikeCache();
    vi.clearAllMocks();
    vi.mocked(api.hike).mockImplementation(async (p) => ({ hike: p.lat === 37 ? HIKE : null }));
  });

  it("requests no hike until the My trip tab is open or a stop is selected", async () => {
    render(<TripEditor initialTrip={trip} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(api.hike).not.toHaveBeenCalled();
    expect(screen.getByTestId("map-hikes").textContent).toBe("");
  });

  it("shows the selected stop's hike on the map and clears it when the stop is deselected", async () => {
    render(<TripEditor initialTrip={trip} />);
    await userEvent.click(screen.getByText("click first marker"));
    await waitFor(() => expect(screen.getByTestId("map-hikes").textContent).toBe("a:3"));
    expect(screen.getByTestId("map-route").textContent).toBe("none"); // not the route
    await userEvent.click(screen.getByText("click second marker")); // another stop (no hike)
    await waitFor(() => expect(screen.getByTestId("map-hikes").textContent).toBe(""));
  });

  it("keeps the hike on the map with the Show hike toggle, and drops it when toggled off", async () => {
    render(<TripEditor initialTrip={trip} />);
    await userEvent.click(screen.getByRole("tab", { name: "My trip" }));
    expect(await screen.findByText(/Hike 1\.2 mi one way/)).toBeTruthy();
    expect(screen.getByTestId("map-hikes").textContent).toBe("");
    const toggle = screen.getByRole("button", { name: "Show hike: Arch" });
    await userEvent.click(toggle);
    await waitFor(() => expect(screen.getByTestId("map-hikes").textContent).toBe("a:3"));
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(toggle);
    await waitFor(() => expect(screen.getByTestId("map-hikes").textContent).toBe(""));
    expect(screen.getAllByTestId("stop-hike")).toHaveLength(1); // the other stop has none and shows nothing
  });

  it("shows nothing when the lookup fails", async () => {
    vi.mocked(api.hike).mockRejectedValue(new Error("offline"));
    render(<TripEditor initialTrip={trip} />);
    await userEvent.click(screen.getByRole("tab", { name: "My trip" }));
    await waitFor(() => expect(api.hike).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("stop-hike")).toBeNull();
  });
});
