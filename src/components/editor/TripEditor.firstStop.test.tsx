// @vitest-environment jsdom
// A viewer far from the trip: the stop's solar day differs from the viewer's calendar day around this time.
process.env.TZ = "Pacific/Auckland";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
  api: {
    directions: vi.fn(), addStop: vi.fn(), suggestions: vi.fn(), reorderStops: vi.fn(),
    updateStop: vi.fn(), uploadPhoto: vi.fn(), deleteStop: vi.fn(), updateTrip: vi.fn(), reverseGeocode: vi.fn(), suggestionPopularity: vi.fn(), placePhoto: vi.fn(async () => ({ photo: null })), geocode: vi.fn(), optimizeOrder: vi.fn(),
  },
}));
vi.mock("./MapView", () => ({
  MapView: (p: import("./map-types").MapViewProps) => (
    <div>
      <button type="button" onClick={() => p.onMapClick({ lat: 37.5, lng: -119.5 })}>drop pin</button>
      <button type="button" onClick={() => p.stops[0] && p.onStopClick(p.stops[0].id)}>click first marker</button>
      <button type="button" onClick={() => p.stops[0] && p.onStopMove?.(p.stops[0].id, { lat: 38, lng: -118 })}>drag first marker</button>
      <button type="button" onClick={() => p.stops[0] && p.onStopMove?.(p.stops[0].id, { lat: 39, lng: -117 })}>drag first marker elsewhere</button>
      {p.stops[0] && <span data-testid="first-stop">{p.stops[0].lat},{p.stops[0].lng}</span>}
      {p.routeGeometry && <span data-testid="route-line">{p.routeGeometry.length}</span>}
      <button type="button" onClick={() => p.suggestions?.[0] && p.onSuggestionClick?.(p.suggestions[0].osmId)}>click first suggestion</button>
      {p.pending && <span data-testid="pending-pin">{p.pending.lat},{p.pending.lng}</span>}
    </div>
  ),
}));
vi.mock("./SearchBar", () => ({ SearchBar: () => null }));
import { api } from "@/lib/api-client";
import { solarDateAt } from "@/lib/best-time";
import type { Stop, TripWithStops } from "@/lib/types";
import { TripEditor } from "./TripEditor";

const LA = { lat: 34.05, lng: -118.24 };
const trip: TripWithStops = { id: "t1", name: "LA", plannedDate: "2026-10-20", departAt: null, shareToken: null, stops: [] };
const stop = (over: Partial<Stop>): Stop => ({
  id: "s1", tripId: "t1", order: 0, name: "Pin 1", lat: LA.lat, lng: LA.lng, notes: null, source: "manual", photoUrl: null, visited: false, lightPref: "any", priority: "normal", dwellMinutes: 30, shotNotes: null, shotChecklist: [], ...over,
});

describe("TripEditor first stop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.directions).mockRejectedValue(new Error("no route"));
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [] });
    vi.mocked(api.reverseGeocode).mockResolvedValue({ place: { name: "Griffith", ...LA } });
    vi.mocked(api.addStop).mockResolvedValue({ stop: stop({}) });
    vi.mocked(api.updateTrip).mockImplementation(async (_id, patch) => ({ trip: { ...trip, ...patch } as never }));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T20:00:00Z")); // 09:00 on the 18th in Auckland
  });
  afterEach(() => vi.useRealTimers());

  async function addFirstStop(initial: TripWithStops) {
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(<TripEditor initialTrip={initial} />);
    await user.click(screen.getByRole("button", { name: "drop pin" }));
    await user.click(await screen.findByRole("button", { name: "Add stop" }));
  }

  it("saves the start on the planned solar day at the stop when the first stop is added, once", async () => {
    await addFirstStop(trip);
    await waitFor(() => expect(api.updateTrip).toHaveBeenCalledTimes(1));
    const departAt = vi.mocked(api.updateTrip).mock.calls[0]![1].departAt as string;
    expect(solarDateAt(new Date(departAt), LA.lng)).toBe("2026-10-20");
    expect(new Date(departAt).getUTCSeconds()).toBe(0);
    // A second stop does not save again.
    vi.mocked(api.addStop).mockResolvedValue({ stop: stop({ id: "s2", order: 1 }) });
    await userEvent.click(screen.getByRole("button", { name: "drop pin" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add stop" }));
    await waitFor(() => expect(api.addStop).toHaveBeenCalledTimes(2));
    expect(api.updateTrip).toHaveBeenCalledTimes(1);
  });

  it("leaves an existing start time alone", async () => {
    await addFirstStop({ ...trip, departAt: "2026-10-20T15:00:00.000Z" });
    await waitFor(() => expect(api.addStop).toHaveBeenCalled());
    expect(api.updateTrip).not.toHaveBeenCalled();
  });

  it("does not save anything when the trip already has stops", () => {
    render(<TripEditor initialTrip={{ ...trip, stops: [stop({})] }} />);
    expect(api.updateTrip).not.toHaveBeenCalled();
  });
});
