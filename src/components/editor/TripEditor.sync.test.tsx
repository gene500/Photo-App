// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "../../../tests/helpers/memory-storage";
import { SETTINGS_KEY } from "@/lib/settings";
import { loadTripCopy } from "@/lib/offline-store";
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
  id: "s1", tripId: "t1", order: 0, name: "Pin 1", lat: 37.5, lng: -119.5, notes: null, source: "manual", photoUrl: null, visited: false, lightPref: "any", priority: "normal", dwellMinutes: 30, shotNotes: null, shotChecklist: [], ...over,
});
const mk = (ids: string[], over: Partial<Stop> = {}) => ids.map((id, order) => newStop({ id, order, name: id.toUpperCase(), lat: 36 + order, lng: -119, ...over }));
const withStops = (stops: Stop[], over: Partial<TripWithStops> = {}): TripWithStops => ({ ...trip, ...over, stops });
const openMyTrip = () => userEvent.click(screen.getByRole("tab", { name: "My trip" }));
const openStops = () => userEvent.click(screen.getByRole("tab", { name: "Stops" }));
const count = (n: number) => screen.queryByText(`${n} ${n === 1 ? "stop" : "stops"}`);

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

describe("TripEditor keeps local state in step with the server", () => {
  it("merges a fresher server copy (the page refreshed itself) without remounting: a pending pin survives", async () => {
    const { rerender } = render(<TripEditor initialTrip={withStops(mk(["a", "b"]))} />);
    await userEvent.click(screen.getByRole("button", { name: "drop pin" }));
    await screen.findByTestId("pending-pin");
    rerender(<TripEditor initialTrip={withStops(mk(["a", "b", "c"]), { name: "Renamed" })} />);
    await waitFor(() => expect(count(3)).toBeTruthy());
    expect(screen.getByTestId("pending-pin")).toBeTruthy();
    expect(api.getTrip).not.toHaveBeenCalled();
  });

  it("an add in flight when the fresher copy arrives still shows when its answer lands, and the editor then refetches", async () => {
    let finish!: (v: { stop: Stop }) => void;
    vi.mocked(api.addStop).mockImplementation(() => new Promise((r) => { finish = r; }));
    const added = newStop({ id: "c", order: 2, name: "C", lat: 38, lng: -119 });
    vi.mocked(api.getTrip).mockResolvedValue({ trip: withStops([...mk(["a", "b"]), added]) });
    const { rerender } = render(<TripEditor initialTrip={withStops(mk(["a", "b"]))} />);
    await userEvent.click(screen.getByRole("button", { name: "drop pin" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add stop" }));
    rerender(<TripEditor initialTrip={withStops(mk(["a", "b", "z"].slice(0, 2)), { name: "Renamed elsewhere" })} />); // a snapshot taken before the add
    expect(count(2)).toBeTruthy(); // not applied while a write is in flight
    await act(async () => { finish({ stop: added }); });
    await waitFor(() => expect(count(3)).toBeTruthy());
    await waitFor(() => expect(api.getTrip).toHaveBeenCalledTimes(1)); // the discarded snapshot is replaced by a fresh fetch
    expect(count(3)).toBeTruthy();
  });

  it("tells the list page to reload when a write lands after the editor was left", async () => {
    let finish!: (v: { stop: Stop }) => void;
    vi.mocked(api.addStop).mockImplementation(() => new Promise((r) => { finish = r; }));
    const landed = vi.fn();
    window.addEventListener("rtpp:write-landed", landed);
    const { unmount } = render(<TripEditor initialTrip={withStops(mk(["a", "b"]))} />);
    await userEvent.click(screen.getByRole("button", { name: "drop pin" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add stop" }));
    unmount();
    expect(landed).not.toHaveBeenCalled();
    await act(async () => { finish({ stop: newStop({ id: "c", order: 2 }) }); });
    expect(landed).toHaveBeenCalledTimes(1);
    window.removeEventListener("rtpp:write-landed", landed);
  });

  it("refetches the trip after 'The trip's stops changed' (409) so retrying can work", async () => {
    vi.mocked(api.reorderStops).mockRejectedValue(Object.assign(new Error("The trip's stops changed; reload and try again"), { status: 409 }));
    vi.mocked(api.getTrip).mockResolvedValue({ trip: withStops(mk(["a", "b", "c"])) });
    render(<TripEditor initialTrip={withStops(mk(["a", "b"]))} />);
    await userEvent.click(screen.getByRole("button", { name: "reorder" }));
    expect((await screen.findByRole("alert")).textContent).toContain("stops changed");
    await waitFor(() => expect(count(3)).toBeTruthy());
    expect(api.getTrip).toHaveBeenCalledWith("t1");
  });

  it("refetches the trip when a stop update answers 404 (the stop was deleted elsewhere)", async () => {
    vi.mocked(api.updateStop).mockRejectedValue(Object.assign(new Error("Stop not found"), { status: 404 }));
    vi.mocked(api.getTrip).mockResolvedValue({ trip: withStops(mk(["b"])) });
    render(<TripEditor initialTrip={withStops(mk(["a", "b"]))} />);
    await openMyTrip();
    await userEvent.click(screen.getByLabelText("Visited: A"));
    await waitFor(() => expect(count(1)).toBeTruthy());
  });

  it("a failed refetch changes nothing", async () => {
    vi.mocked(api.reorderStops).mockRejectedValue(Object.assign(new Error("changed"), { status: 409 }));
    vi.mocked(api.getTrip).mockRejectedValue(new Error("offline"));
    render(<TripEditor initialTrip={withStops(mk(["a", "b"]))} />);
    await userEvent.click(screen.getByRole("button", { name: "reorder" }));
    await waitFor(() => expect(api.getTrip).toHaveBeenCalled());
    expect(count(2)).toBeTruthy();
  });

  it("does not store an offline copy from a stale view: it catches up with the server first and saves that", async () => {
    localStorage.setItem("rtpp.offline.owner", "u1");
    const server = withStops(mk(["a", "b", "c"]));
    vi.mocked(api.getTrip).mockResolvedValue({ trip: server });
    render(<TripEditor initialTrip={withStops(mk(["a", "b"]))} userId="u1" />);
    await waitFor(() => expect(count(3)).toBeTruthy(), { timeout: 4000 });
    await waitFor(() => expect(loadTripCopy("t1")?.trip.stops).toHaveLength(3), { timeout: 4000 });
  });

  it("saves no offline copy for a trip that was deleted elsewhere", async () => {
    localStorage.setItem("rtpp.offline.owner", "u1");
    vi.mocked(api.getTrip).mockRejectedValue(Object.assign(new Error("Trip not found"), { status: 404 }));
    render(<TripEditor initialTrip={withStops(mk(["a", "b"]))} userId="u1" />);
    await waitFor(() => expect(api.getTrip).toHaveBeenCalled(), { timeout: 4000 });
    expect(loadTripCopy("t1")).toBeNull();
  });
});

describe("TripEditor photo and share writes count as writes", () => {
  it("a refetch answered after a photo upload does not drop the new photo", async () => {
    vi.mocked(api.reorderStops).mockRejectedValue(Object.assign(new Error("stops changed"), { status: 409 }));
    let answer!: (v: { trip: TripWithStops }) => void;
    vi.mocked(api.getTrip).mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const seed = mk(["a", "b"]);
    vi.mocked(api.uploadPhoto).mockResolvedValue({ stop: { ...seed[0], photoUrl: "/api/uploads/new.png" } });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await userEvent.click(screen.getByRole("button", { name: "reorder" }));
    await waitFor(() => expect(api.getTrip).toHaveBeenCalledTimes(1)); // in flight, asked before the upload
    await userEvent.click(screen.getByRole("button", { name: "click first marker" }));
    await userEvent.click(within(await screen.findByRole("region", { name: "Selected stop" })).getByRole("button", { name: "Open details" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit A" });
    vi.mocked(api.getTrip).mockResolvedValue({ trip: withStops([{ ...seed[0], photoUrl: "/api/uploads/new.png" }, seed[1]]) });
    await userEvent.upload(within(dialog).getByLabelText("Upload photo"), new File(["x"], "p.png", { type: "image/png" }));
    await waitFor(() => expect(api.uploadPhoto).toHaveBeenCalled());
    // The old answer (no photo, stale name) lands now: it must not be adopted.
    await act(async () => { answer({ trip: withStops([{ ...seed[0], name: "OLD" }, seed[1]]) }); });
    await waitFor(() => expect(api.getTrip).toHaveBeenCalledTimes(2)); // asked again instead
    expect(screen.queryByText("OLD")).toBeNull();
  });
});

describe("TripEditor visited run and swaps", () => {
  it("a swap of a visited stop goes through the server's rule: later stops lose their check in the UI too", async () => {
    const four = mk(["a", "b", "c", "d"]).map((s, i) => ({ ...s, visited: i < 3 }));
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [{ osmId: "n1", name: "Alt", lat: 36.5, lng: -119.1, kind: "viewpoint" } as never] });
    vi.mocked(api.updateStop).mockImplementation(async (id, patch) => {
      const at = four.findIndex((x) => x.id === id);
      return { stop: { ...four[at], ...patch } as Stop, stops: four.filter((x, i) => i > at && x.visited).map((x) => ({ ...x, visited: false })) };
    });
    render(<TripEditor initialTrip={withStops(four)} />);
    await userEvent.click(screen.getByRole("button", { name: "click first marker" }));
    await userEvent.click(within(await screen.findByRole("region", { name: "Selected stop" })).getByRole("button", { name: "Open details" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit A" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Find alternatives/ }));
    await userEvent.click(await within(dialog).findByRole("button", { name: /Swap/ }));
    await waitFor(() => expect(api.updateStop).toHaveBeenCalledTimes(1));
    await openMyTrip();
    await waitFor(() => expect((screen.getByLabelText("Visited: C") as HTMLInputElement).checked).toBe(false));
    expect((screen.getByLabelText("Visited: B") as HTMLInputElement).checked).toBe(false);
  });
});

describe("TripEditor undo swap re-tick", () => {
  async function swapFirstOfFour() {
    const four = mk(["a", "b", "c", "d"]).map((s, i) => ({ ...s, visited: i < 3 }));
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [{ osmId: "n1", name: "Alt", lat: 36.5, lng: -119.1, kind: "viewpoint" } as never] });
    vi.mocked(api.updateStop).mockImplementation(async (id, patch) => {
      const at = four.findIndex((x) => x.id === id);
      return { stop: { ...four[at], ...patch } as Stop, stops: patch.visited === false ? four.filter((x, i) => i > at && x.visited).map((x) => ({ ...x, visited: false })) : undefined };
    });
    render(<TripEditor initialTrip={withStops(four)} />);
    await userEvent.click(screen.getByRole("button", { name: "click first marker" }));
    await userEvent.click(within(await screen.findByRole("region", { name: "Selected stop" })).getByRole("button", { name: "Open details" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit A" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Find alternatives/ }));
    await userEvent.click(await within(dialog).findByRole("button", { name: /Swap/ }));
    await waitFor(() => expect(api.updateStop).toHaveBeenCalledTimes(1));
    return four;
  }

  it("ticks the cascaded stops again when the list is as the swap left it", async () => {
    await swapFirstOfFour();
    await userEvent.click(await screen.findByRole("button", { name: "Undo swap" }));
    await waitFor(() => expect(api.updateStop).toHaveBeenCalledTimes(3));
    expect(api.updateStop).toHaveBeenLastCalledWith("c", { visited: true });
  });

  it("skips the re-tick, with a note, when the list was reordered after the swap", async () => {
    const four = await swapFirstOfFour();
    vi.mocked(api.reorderStops).mockResolvedValue({ stops: [...four].reverse().map((st, order) => ({ ...st, order })) });
    await userEvent.click(screen.getByRole("button", { name: "reorder" })); // d, c, b, a
    await userEvent.click(await screen.findByRole("button", { name: "Undo swap" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("not marked visited again"));
    expect(api.updateStop).toHaveBeenCalledTimes(2); // the swap and its undo, nothing else
  });
});

describe("TripEditor announcements and notes", () => {
  it("announces a delete and a reorder", async () => {
    vi.mocked(api.deleteStop).mockResolvedValue(undefined as never);
    vi.mocked(api.reorderStops).mockImplementation(async (_t, ids) => ({ stops: ids.map((id, order) => ({ ...mk(["a", "b", "c"]).find((s) => s.id === id)!, order })) }));
    render(<TripEditor initialTrip={withStops(mk(["a", "b", "c"]))} />);
    await userEvent.click(screen.getByRole("button", { name: "reorder" }));
    await waitFor(() => expect(screen.getByTestId("announcer").textContent).toMatch(/^Moved .+ to position \d of 3\.$/));
    await openStops();
    await userEvent.click(screen.getByRole("button", { name: "Delete B" }));
    await userEvent.click(within(screen.getByRole("alertdialog", { name: "Delete stop?" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByTestId("announcer").textContent).toBe("Deleted B. 2 stops left in your trip."));
  });

  it("clears 'Route optimized. Undo is available.' once Undo is retired", async () => {
    const three = mk(["a", "b", "c"]);
    vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 2, 1] });
    vi.mocked(api.reorderStops).mockImplementation(async (_t, ids) => ({ stops: ids.map((id, order) => ({ ...three.find((s) => s.id === id)!, order })) }));
    vi.mocked(api.updateTrip).mockImplementation(async (_id, patch) => ({ trip: { ...trip, ...patch } as never }));
    const { rerender } = render(<TripEditor initialTrip={withStops(three)} />);
    await openMyTrip();
    await userEvent.click(screen.getByRole("button", { name: "Optimize route" }));
    await waitFor(() => expect(screen.getByTestId("announcer").textContent).toBe("Route optimized. Undo is available."));
    const four = withStops([...three, newStop({ id: "d", order: 3, name: "D", lat: 40, lng: -119 })]);
    vi.mocked(api.getTrip).mockResolvedValue({ trip: four }); // this editor wrote meanwhile, so it asks again instead of trusting the pushed copy
    rerender(<TripEditor initialTrip={four} />); // another tab added a stop: Undo is gone
    await waitFor(() => expect(count(4)).toBeTruthy());
    expect(screen.getByTestId("announcer").textContent).toBe("");
  });

  it("leaves visited stops out of the 'can't fit in daylight' list", async () => {
    const four = mk(["a", "b", "c", "d"]).map((s, i) => ({ ...s, visited: i < 2 }));
    vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 1, 2], dark: [{ stopIndex: 0, minutes: 30 }, { stopIndex: 2, minutes: 30 }], misses: [{ stopIndex: 0, minutes: 5 }] });
    vi.mocked(api.updateTrip).mockImplementation(async (_id, patch) => ({ trip: { ...trip, ...patch } as never }));
    render(<TripEditor initialTrip={withStops(four)} />);
    await openMyTrip();
    await userEvent.click(screen.getByRole("button", { name: "Optimize route" }));
    await waitFor(() => expect(screen.getByTestId("optimize-status").textContent).toContain("Can't fit 1 stop in daylight: D"));
    expect(screen.getByTestId("optimize-status").textContent).not.toMatch(/: B|B,/);
    expect(screen.getByTestId("optimize-status").textContent).not.toContain("in its light");
  });

  it("writes the 'Start time moved' note out at render time, so a time-format change shows in it", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ timeFormat: "12h" }));
    vi.resetModules();
    const { SettingsProvider } = await import("@/components/settings/SettingsProvider");
    const { TripEditor: Editor } = await import("./TripEditor");
    const { api: freshApi } = await import("@/lib/api-client");
    vi.mocked(freshApi.suggestions).mockResolvedValue({ suggestions: [] });
    vi.mocked(freshApi.locate).mockResolvedValue({ area: null });
    vi.mocked(freshApi.directions).mockResolvedValue({ route });
    const three = mk(["a", "b", "c"]);
    vi.mocked(freshApi.optimizeOrder).mockResolvedValue({ order: [0, 1, 2], departAt: "2026-07-01T23:15:00.000Z" });
    vi.mocked(freshApi.updateTrip).mockImplementation(async (_id, patch) => ({ trip: { ...trip, ...patch } as never }));
    render(<SettingsProvider><Editor initialTrip={withStops(three)} /></SettingsProvider>);
    await openMyTrip();
    await userEvent.click(screen.getByRole("button", { name: "Optimize route" }));
    await waitFor(() => expect(screen.getByTestId("optimize-status").textContent).toMatch(/^Start time moved to .*(AM|PM)/));
    act(() => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ timeFormat: "24h" }));
      window.dispatchEvent(new StorageEvent("storage", { key: SETTINGS_KEY }));
    });
    await waitFor(() => expect(screen.getByTestId("optimize-status").textContent).toMatch(/^Start time moved to \d{2}:\d{2} so/));
  });

  it("shortens a name over 200 characters before adding the stop", async () => {
    vi.mocked(api.addStop).mockImplementation(async (_t, input) => ({ stop: newStop({ id: "c", order: 2, name: input.name }) }));
    render(<TripEditor initialTrip={withStops(mk(["a", "b"]))} />);
    vi.mocked(api.reverseGeocode).mockResolvedValue({ place: { name: "N".repeat(250), lat: 37.5, lng: -119.5 } });
    await userEvent.click(screen.getByRole("button", { name: "drop pin" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add stop" }));
    await waitFor(() => expect(api.addStop).toHaveBeenCalled());
    expect(vi.mocked(api.addStop).mock.calls[0]![1].name).toHaveLength(200);
  });

  it("announces an optimize result once: the notice speaks, the announcer stays quiet", async () => {
    const three = mk(["a", "b", "c"]);
    vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 2, 1], misses: [{ stopIndex: 1, minutes: 5 }] });
    vi.mocked(api.reorderStops).mockImplementation(async (_t, ids) => ({ stops: ids.map((id, order) => ({ ...three.find((s) => s.id === id)!, order })) }));
    vi.mocked(api.updateTrip).mockImplementation(async (_id, patch) => ({ trip: { ...trip, ...patch } as never }));
    render(<TripEditor initialTrip={withStops(three)} />);
    await openMyTrip();
    await userEvent.click(screen.getByRole("button", { name: "Optimize route" }));
    await waitFor(() => expect(screen.getByTestId("optimize-status").textContent).toContain("Can't fit"));
    expect(screen.getByTestId("announcer").textContent).toBe("");
  });
});
