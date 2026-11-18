// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "../../../tests/helpers/memory-storage";
import { SETTINGS_KEY } from "@/lib/settings";
import { resetPlacePhotoCache } from "@/lib/place-photo-cache";

vi.mock("@/lib/api-client", () => ({
  api: {
    directions: vi.fn(), addStop: vi.fn(), suggestions: vi.fn(), reorderStops: vi.fn(),
    updateStop: vi.fn(), uploadPhoto: vi.fn(), deleteStop: vi.fn(), updateTrip: vi.fn(), reverseGeocode: vi.fn(), suggestionPopularity: vi.fn(), placePhoto: vi.fn(async () => ({ photo: null })), geocode: vi.fn(), optimizeOrder: vi.fn(), getTrip: vi.fn(), locate: vi.fn(async () => ({ area: null })),
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
      {p.flyTo && <span data-testid="fly-to">{p.flyTo.lat},{p.flyTo.lng},{p.flyTo.area ? "area" : "point"}</span>}
      {p.pending && <span data-testid="pending-pin">{p.pending.lat},{p.pending.lng}</span>}
    </div>
  ),
}));
vi.mock("./SearchBar", () => ({
  SearchBar: ({ onSelect }: { onSelect: (p: { name: string; lat: number; lng: number }) => void }) => (
    <button type="button" onClick={() => onSelect({ name: "Fresno, California", lat: 36.74, lng: -119.79 })}>pick place</button>
  ),
}));
// dnd-kit's drag gestures can't be simulated in jsdom, so the real StopList is kept for
// rendering but wrapped with a button that invokes the same onReorder a drag-end would.
vi.mock("./StopList", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./StopList")>();
  type Props = Parameters<typeof actual.StopList>[0];
  function StopList(props: Props) {
    return (
      <>
        <button type="button" onClick={() => props.onReorder([...props.stops].reverse().map((s) => s.id))}>reorder</button>
        <actual.StopList {...props} />
      </>
    );
  }
  return { ...actual, StopList };
});
vi.mock("@/lib/itinerary-download", () => ({
  createItineraryPdf: vi.fn(), loadWeatherLines: vi.fn(), saveBlob: vi.fn(), mapTokenFromEnv: vi.fn(() => null),
}));
import { api } from "@/lib/api-client";
import type { Stop, TripWithStops } from "@/lib/types";
import { TripEditor } from "./TripEditor";

const trip: TripWithStops = { id: "t1", name: "Sierra loop", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] };
const route = { geometry: [[-119.79, 36.74], [-119.12, 37.96]] as [number, number][], legs: [{ distance: 100_000, duration: 3_600 }], distance: 100_000, duration: 3_600 };
const newStop = (over: Partial<Stop>): Stop => ({
  id: "s1", tripId: "t1", order: 0, name: "Pin 1", lat: 37.5, lng: -119.5, notes: null, source: "manual", photoUrl: null, visited: false, lightPref: "any", priority: "normal", dwellMinutes: 30, shotNotes: null, shotChecklist: [], access: null, accessResolvedAt: null, ...over,
});
const mk = (ids: string[], over: Partial<Stop> = {}) => ids.map((id, order) => newStop({ id, order, name: id.toUpperCase(), lat: 36 + order, lng: -119, ...over }));
const withStops = (stops: Stop[], over: Partial<TripWithStops> = {}): TripWithStops => ({ ...trip, ...over, stops });
const openMyTrip = () => userEvent.click(screen.getByRole("tab", { name: "My trip" }));
const openStops = () => userEvent.click(screen.getByRole("tab", { name: "Stops" }));

beforeEach(() => {
  window.sessionStorage.clear();
  installMemoryStorage();
  vi.clearAllMocks();
  resetPlacePhotoCache();
  vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [] });
  vi.mocked(api.locate).mockResolvedValue({ area: null });
  vi.mocked(api.directions).mockResolvedValue({ route });
  vi.mocked(api.reverseGeocode).mockResolvedValue({ place: { name: "Tunnel View", lat: 37.5, lng: -119.5 } });
});

describe("TripEditor fixes (F2)", () => {
  it("overlapping stop deletes each announce the count left when they land", async () => {
    const four = mk(["a", "b", "c", "d"]);
    const finish: Array<() => void> = [];
    vi.mocked(api.deleteStop).mockImplementation(() => new Promise<never>((r) => finish.push(() => r(undefined as never))));
    render(<TripEditor initialTrip={withStops(four)} />);
    await openStops();
    await userEvent.click(screen.getByRole("button", { name: "Delete A" }));
    await userEvent.click(within(screen.getByRole("alertdialog", { name: "Delete stop?" })).getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete B" }));
    await userEvent.click(within(screen.getByRole("alertdialog", { name: "Delete stop?" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.deleteStop).toHaveBeenCalledTimes(2));
    await act(async () => { finish[0]!(); });
    await waitFor(() => expect(screen.getByTestId("announcer").textContent).toBe("Deleted A. 3 stops left in your trip."));
    await act(async () => { finish[1]!(); });
    await waitFor(() => expect(screen.getByTestId("announcer").textContent).toBe("Deleted B. 2 stops left in your trip."));
  });

  it("says 'Trip not found' instead of announcing an empty trip when the trip was deleted in another tab", async () => {
    vi.mocked(api.deleteStop).mockRejectedValue(Object.assign(new Error("Stop not found"), { status: 404 }));
    vi.mocked(api.getTrip).mockRejectedValue(Object.assign(new Error("Trip not found"), { status: 404 }));
    render(<TripEditor initialTrip={withStops(mk(["a", "b"]))} />);
    await openStops();
    await userEvent.click(screen.getByRole("button", { name: "Delete B" }));
    await userEvent.click(within(screen.getByRole("alertdialog", { name: "Delete stop?" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Trip not found"));
    expect(screen.getByTestId("announcer").textContent).not.toMatch(/stops? left/);
  });

  it("Escape on the marker that opened the stop card gives focus back to that marker", async () => {
    render(<TripEditor initialTrip={withStops(mk(["a", "b"]))} />);
    const marker = screen.getByRole("button", { name: "click first marker" });
    await userEvent.click(marker);
    await screen.findByRole("region", { name: "Selected stop" });
    expect(document.activeElement).toBe(marker);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("region", { name: "Selected stop" })).toBeNull());
    expect(document.activeElement).toBe(marker);
  });

  it("drops the optimize note once a stop's light preference changes", async () => {
    const three = mk(["a", "b", "c"]);
    vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 1, 2], misses: [{ stopIndex: 1, minutes: 5 }] });
    vi.mocked(api.updateTrip).mockImplementation(async (_id, patch) => ({ trip: { ...trip, ...patch } as never }));
    const { rerender } = render(<TripEditor initialTrip={withStops(three)} />);
    await openMyTrip();
    await userEvent.click(screen.getByRole("button", { name: "Optimize route" }));
    await waitFor(() => expect(screen.getByTestId("optimize-status").textContent).toContain("Can't fit"));
    const edited = three.map((s) => (s.id === "b" ? { ...s, lightPref: "golden" as const } : s));
    vi.mocked(api.getTrip).mockResolvedValue({ trip: withStops(edited) }); // this editor wrote meanwhile, so it asks again instead of trusting the pushed copy
    rerender(<TripEditor initialTrip={withStops(edited)} />);
    await waitFor(() => expect(api.getTrip).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("optimize-status")?.textContent ?? "").not.toContain("Can't fit"));
  });

  it("shows the server's reason when Optimize is refused", async () => {
    vi.mocked(api.optimizeOrder).mockRejectedValue(Object.assign(new Error("Start time must be between 1970 and 2200"), { status: 400 }));
    render(<TripEditor initialTrip={withStops(mk(["a", "b", "c"]))} />);
    await openMyTrip();
    await userEvent.click(screen.getByRole("button", { name: "Optimize route" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Start time must be between 1970 and 2200"));
  });

  it("the 24-hour setting shows the Start time as hour and minute selects", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ timeFormat: "24h" }));
    vi.resetModules();
    const { SettingsProvider } = await import("@/components/settings/SettingsProvider");
    const { TripEditor: Editor } = await import("./TripEditor");
    const { api: freshApi } = await import("@/lib/api-client");
    vi.mocked(freshApi.suggestions).mockResolvedValue({ suggestions: [] });
    vi.mocked(freshApi.locate).mockResolvedValue({ area: null });
    vi.mocked(freshApi.directions).mockResolvedValue({ route });
    render(<SettingsProvider><Editor initialTrip={withStops(mk(["a", "b"]), { departAt: "2026-07-01T14:05:00.000Z" })} /></SettingsProvider>);
    await openMyTrip();
    expect(await screen.findByLabelText("Start time hour")).toBeTruthy();
    expect(screen.getByLabelText("Start time minute")).toBeTruthy();
  });

  it("Optimize waits for the whole start-time save chain: hour save in flight, minute picked, Optimize pressed", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ timeFormat: "24h" }));
    vi.resetModules();
    const { SettingsProvider } = await import("@/components/settings/SettingsProvider");
    const { TripEditor: Editor } = await import("./TripEditor");
    const { api: freshApi } = await import("@/lib/api-client");
    vi.mocked(freshApi.suggestions).mockResolvedValue({ suggestions: [] });
    vi.mocked(freshApi.locate).mockResolvedValue({ area: null });
    vi.mocked(freshApi.directions).mockResolvedValue({ route });
    vi.mocked(freshApi.optimizeOrder).mockResolvedValue({ order: [0, 1, 2], departAt: null, misses: [] } as never);
    const finish: Array<(departAt: string) => void> = [];
    const sent: Array<string | null | undefined> = [];
    vi.mocked(freshApi.updateTrip).mockImplementation((_id, patch) => {
      sent.push(patch.departAt);
      return new Promise((resolve) => finish.push((departAt) => resolve({ trip: { ...trip, stops: mk(["a", "b", "c"]), departAt } as never })));
    });
    render(<SettingsProvider><Editor initialTrip={withStops(mk(["a", "b", "c"]), { departAt: "2026-07-01T14:05:00.000Z" })} /></SettingsProvider>);
    await openMyTrip();
    await userEvent.selectOptions(await screen.findByLabelText("Start time hour"), "09");
    await waitFor(() => expect(freshApi.updateTrip).toHaveBeenCalledTimes(1)); // the hour save is now in flight
    await userEvent.selectOptions(screen.getByLabelText("Start time minute"), "30"); // queued behind it
    await userEvent.click(screen.getByRole("button", { name: "Optimize route" }));
    await act(async () => { finish[0]!(sent[0] as string); });
    await waitFor(() => expect(freshApi.updateTrip).toHaveBeenCalledTimes(2)); // the loop saves the newer time
    expect(freshApi.optimizeOrder).not.toHaveBeenCalled(); // still waiting: the first save alone is not the final time
    await act(async () => { finish[1]!(sent[1] as string); });
    await waitFor(() => expect(freshApi.optimizeOrder).toHaveBeenCalledTimes(1));
    const options = vi.mocked(freshApi.optimizeOrder).mock.calls[0]![1] as { departAt?: string };
    expect(options.departAt).toBe(sent[1]);
    expect(sent[1]).not.toBe(sent[0]);
  });
});
