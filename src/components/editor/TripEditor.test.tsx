// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "../../../tests/helpers/memory-storage";
import { SETTINGS_KEY } from "@/lib/settings";
import { resetPlacePhotoCache } from "@/lib/place-photo-cache";

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
import { api } from "@/lib/api-client";
import type { Stop, TripWithStops } from "@/lib/types";
import { solarDateAt } from "@/lib/best-time";
import { TripEditor } from "./TripEditor";

const trip: TripWithStops = { id: "t1", name: "Sierra loop", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] };
const route = { geometry: [[-119.79, 36.74], [-119.12, 37.96]] as [number, number][], legs: [{ distance: 100_000, duration: 3_600 }], distance: 100_000, duration: 3_600 };
const newStop = (over: Partial<Stop>): Stop => ({
  id: "s1", tripId: "t1", order: 0, name: "Pin 1", lat: 37.5, lng: -119.5, notes: null, source: "manual", photoUrl: null, visited: false, lightPref: "any", priority: "normal", dwellMinutes: 30, shotNotes: null, shotChecklist: [], ...over,
});
const seed = [
  newStop({ id: "a", order: 0, name: "A", lat: 36.74, lng: -119.79 }),
  newStop({ id: "b", order: 1, name: "B", lat: 37.96, lng: -119.12 }),
];
const withStops = (stops: Stop[]) => ({ ...trip, stops });

// The optimize result is only announced to screen readers; nothing shows under the button.
function expectOptimizeNoteHidden() {
  expect(screen.getByTestId("optimize-status").className).toBe("sr-only");
}

describe("TripEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPlacePhotoCache();
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [] });
    vi.mocked(api.reverseGeocode).mockResolvedValue({ place: { name: "Tunnel View", lat: 37.5, lng: -119.5 } });
  });

  it("asks for stops and skips routing until there are two", () => {
    render(<TripEditor initialTrip={trip} />);
    expect(screen.getByTestId("empty-hint").textContent).toBe("Search for a place or click the map to add your first stop.");
    expect(screen.getByTestId("route-status").textContent).toBe("Add 2 stops to see the route");
    expect(api.directions).not.toHaveBeenCalled();
  });

  it("loads the route through the stops in order and shows its summary", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toBe("62 mi · 1 h 0 min"));
    expect(api.directions).toHaveBeenCalledWith([[-119.79, 36.74], [-119.12, 37.96]]);
  });

  it("shows a dismissible route error while the rest of the editor keeps working", async () => {
    vi.mocked(api.directions).mockRejectedValue(new Error("No driving route found between these points"));
    render(<TripEditor initialTrip={withStops(seed)} />);
    expect((await screen.findByRole("alert")).textContent).toContain("No driving route found");
    expect(screen.getByTestId("route-status").textContent).toBe("Route unavailable");
    await userEvent.click(screen.getByRole("button", { name: "drop pin" }));
    expect(await screen.findByRole("region", { name: "Selected place" })).toBeTruthy();
  });

  it("names a clicked spot, then adds it as a stop and refetches the route", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.addStop).mockResolvedValue({ stop: newStop({ id: "c", order: 2, name: "Tunnel View" }) });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await userEvent.click(screen.getByRole("button", { name: "drop pin" }));
    expect(api.reverseGeocode).toHaveBeenCalledWith(37.5, -119.5);
    expect(await screen.findByText("Tunnel View")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add stop" }));
    expect(api.addStop).toHaveBeenCalledWith("t1", { name: "Tunnel View", lat: 37.5, lng: -119.5, source: "manual" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Selected place" })).toBeNull());
    await waitFor(() => expect(api.directions).toHaveBeenLastCalledWith([[-119.79, 36.74], [-119.12, 37.96], [-119.5, 37.5]]));
  });

  it("shows the server's error when adding a stop is rejected", async () => {
    vi.mocked(api.addStop).mockRejectedValue(new Error("A trip can have at most 25 stops"));
    render(<TripEditor initialTrip={trip} />);
    await userEvent.click(screen.getByRole("button", { name: "drop pin" }));
    await screen.findByText("Tunnel View");
    await userEvent.click(screen.getByRole("button", { name: "Add stop" }));
    expect((await screen.findByRole("alert")).textContent).toContain("at most 25 stops");
  });

  it("never sticks on Loading after the route error is dismissed", async () => {
    vi.mocked(api.directions).mockRejectedValue(new Error("No driving route found"));
    render(<TripEditor initialTrip={withStops(seed)} />);
    const alert = await screen.findByRole("alert");
    await userEvent.click(within(alert).getByRole("button"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("route-status").textContent).toBe("Route unavailable");
  });

  it("drops the old route while a new one loads after stops change", async () => {
    vi.mocked(api.directions).mockResolvedValueOnce({ route });
    vi.mocked(api.updateStop).mockResolvedValue({ stop: { ...seed[0], lat: 38, lng: -118 } });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await waitFor(() => expect(screen.getByTestId("route-line")).toBeTruthy());
    vi.mocked(api.directions).mockImplementation(() => new Promise(() => {}));
    await userEvent.click(screen.getByRole("button", { name: "drag first marker" }));
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toBe("Loading route…"));
    expect(screen.queryByTestId("route-line")).toBeNull();
  });

  it("keeps a newer place card when an earlier add finishes", async () => {
    let resolveAdd!: (v: { stop: Stop }) => void;
    vi.mocked(api.addStop).mockImplementation(() => new Promise((r) => { resolveAdd = r; }));
    render(<TripEditor initialTrip={trip} />);
    await userEvent.click(screen.getByRole("button", { name: "drop pin" }));
    await screen.findByText("Tunnel View");
    await userEvent.click(screen.getByRole("button", { name: "Add stop" }));
    await userEvent.click(screen.getByRole("button", { name: "pick place" }));
    await act(async () => { resolveAdd({ stop: newStop({ name: "Tunnel View" }) }); });
    expect(screen.getByText("Fresno, California")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Selected place" })).toBeTruthy();
  });

  it("falls back to the coordinates when the place lookup fails", async () => {
    vi.mocked(api.reverseGeocode).mockRejectedValue(new Error("Place lookup failed"));
    render(<TripEditor initialTrip={trip} />);
    await userEvent.click(screen.getByRole("button", { name: "drop pin" }));
    expect(await screen.findByText("37.5000, -119.5000")).toBeTruthy();
  });

  it("opens a search result as a pending place without a reverse lookup", async () => {
    vi.mocked(api.addStop).mockResolvedValue({ stop: newStop({ name: "Fresno, California", lat: 36.74, lng: -119.79 }) });
    render(<TripEditor initialTrip={trip} />);
    await userEvent.click(screen.getByRole("button", { name: "pick place" }));
    expect(screen.getByText("Fresno, California")).toBeTruthy();
    expect(screen.getByTestId("pending-pin").textContent).toBe("36.74,-119.79");
    expect(api.reverseGeocode).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Add stop" }));
    expect(api.addStop).toHaveBeenCalledWith("t1", { name: "Fresno, California", lat: 36.74, lng: -119.79, source: "manual" });
    expect((await screen.findAllByTestId("stop-row"))).toHaveLength(1);
  });

  it("searches around the first stop automatically, without a button or a route", async () => {
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [{ osmId: "node/1", name: "Tunnel View", lat: 37.7, lng: -119.7, kind: "viewpoint" }] });
    render(<TripEditor initialTrip={withStops([seed[0]])} />);
    await waitFor(() => expect(api.suggestions).toHaveBeenCalledWith({ around: [-119.79, 36.74] }, { enrich: false }));
    expect(api.suggestions).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("tab", { name: /Suggestions/ }));
    expect(await screen.findByRole("button", { name: /^Accept/ })).toBeTruthy();
    expect(api.directions).not.toHaveBeenCalled();
  });

  it("shows the first 5 suggestions at once and reveals the rest 5 at a time as popularity arrives", async () => {
    const found = Array.from({ length: 12 }, (_, i) => ({ osmId: `node/${i + 1}`, name: `Spot ${i + 1}`, lat: 37.7 + i / 100, lng: -119.7, kind: "viewpoint" as const }));
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: found });
    const releases: Array<() => void> = [];
    vi.mocked(api.suggestionPopularity).mockImplementation(
      (places) => new Promise((resolve) => releases.push(() => resolve({ counts: places.map(() => 1) }))),
    );
    render(<TripEditor initialTrip={withStops([seed[0]])} />);
    await userEvent.click(screen.getByRole("tab", { name: /Suggestions/ }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Accept/ })).toHaveLength(5));
    await waitFor(() => expect(releases).toHaveLength(3)); // all three batches are asked for at once (window of 4)
    await act(async () => releases[1]()); // the later one answering first reveals nothing yet
    expect(screen.getAllByRole("button", { name: /^Accept/ })).toHaveLength(5);
    await act(async () => releases[0]());
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Accept/ })).toHaveLength(12));
  });

  it("retries the around search by hand after an error", async () => {
    vi.mocked(api.suggestions).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [{ osmId: "node/1", name: "Tunnel View", lat: 37.7, lng: -119.7, kind: "viewpoint" }] });
    render(<TripEditor initialTrip={withStops([seed[0]])} />);
    await userEvent.click(screen.getByRole("tab", { name: /Suggestions/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: /^Accept/ })).toBeTruthy();
    expect(api.suggestions).toHaveBeenLastCalledWith({ around: [-119.79, 36.74] }, { enrich: false });
  });

  it("quietly fetches the place list once the route is steady and answers 'Find' from it without asking again", async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ osmId: `node/${i}`, name: `Spot ${i}`, lat: 37.7 + i / 100, lng: -119.7, kind: "viewpoint" as const }));
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: six });
    vi.mocked(api.suggestionPopularity).mockResolvedValue({ counts: six.map(() => 7) });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await waitFor(() => expect(api.suggestions).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(api.suggestionPopularity).not.toHaveBeenCalled(); // popularity waits for the click
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    expect(screen.queryAllByTestId("suggestion-card")).toHaveLength(0); // nothing is shown until asked
    await userEvent.click(screen.getByRole("button", { name: "Find photo spots" }));
    expect((await screen.findAllByTestId("suggestion-card")).length).toBeGreaterThan(0);
    expect(api.suggestions).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.suggestionPopularity).toHaveBeenCalled());
  });

  it("a quick 'Find' searches once and the pending quiet search does not repeat it", async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ osmId: `node/${i}`, name: `Spot ${i}`, lat: 37.7 + i / 100, lng: -119.7, kind: "viewpoint" as const }));
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: six });
    vi.mocked(api.suggestionPopularity).mockResolvedValue({ counts: six.map(() => 7) });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toMatch(/\d mi\b/));
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    await userEvent.click(screen.getByRole("button", { name: "Find photo spots" }));
    expect((await screen.findAllByTestId("suggestion-card")).length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 900)); // past the quiet-search delay
    expect(api.suggestions).toHaveBeenCalledTimes(1);
  });

  it("searches again when the quiet search was only a stand-in (degraded), even with enough places", async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ osmId: `node/${i}`, name: `Spot ${i}`, lat: 37.7 + i / 100, lng: -119.7, kind: "viewpoint" as const }));
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.suggestions).mockResolvedValueOnce({ suggestions: six, degraded: true }).mockResolvedValue({ suggestions: six, degraded: false });
    vi.mocked(api.suggestionPopularity).mockResolvedValue({ counts: six.map(() => 7) });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await waitFor(() => expect(api.suggestions).toHaveBeenCalledTimes(1), { timeout: 4000 });
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    await userEvent.click(screen.getByRole("button", { name: "Find photo spots" }));
    expect((await screen.findAllByTestId("suggestion-card")).length).toBeGreaterThan(0);
    expect(api.suggestions).toHaveBeenCalledTimes(2);
  });

  it("searches again when the quiet search found only a thin list", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [{ osmId: "node/1", name: "Tunnel View", lat: 37.7, lng: -119.7, kind: "viewpoint" }] });
    vi.mocked(api.suggestionPopularity).mockResolvedValue({ counts: [7] });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await waitFor(() => expect(api.suggestions).toHaveBeenCalledTimes(1), { timeout: 4000 });
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    await userEvent.click(screen.getByRole("button", { name: "Find photo spots" }));
    expect(await screen.findByTestId("suggestion-card")).toBeTruthy();
    expect(api.suggestions).toHaveBeenCalledTimes(2);
  });

  it("finds suggestions and accepts one from the Suggestions tab", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [{ osmId: "node/1", name: "Tunnel View", lat: 37.7, lng: -119.7, kind: "viewpoint" }] });
    vi.mocked(api.addStop).mockResolvedValue({ stop: newStop({ id: "c", order: 2, name: "Tunnel View", source: "suggested", lat: 37.7, lng: -119.7 }) });
    vi.mocked(api.placePhoto).mockResolvedValue({ photo: { url: "https://upload.wikimedia.org/tv.jpg", title: "Tunnel View", pageUrl: "https://en.wikipedia.org/wiki/Tunnel_View", credit: "Wikipedia" } });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toMatch(/\d mi\b/));
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    await userEvent.click(screen.getByRole("button", { name: "Find photo spots" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Accept/ }));
    expect(api.addStop).toHaveBeenCalledWith("t1", { name: "Tunnel View", lat: 37.7, lng: -119.7, source: "suggested", lightPref: "golden" });
    await userEvent.click(screen.getByRole("tab", { name: "Stops" }));
    expect(screen.getAllByTestId("stop-row")[2].textContent).toContain("Tunnel View");
  });

  it("opens a suggestion marker as a pending place and adds it as a suggested stop", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [{ osmId: "node/1", name: "Tunnel View", lat: 37.7, lng: -119.7, kind: "viewpoint" }] });
    vi.mocked(api.addStop).mockResolvedValue({ stop: newStop({ id: "c", order: 2, name: "Tunnel View", source: "suggested", lat: 37.7, lng: -119.7 }) });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toMatch(/\d mi\b/));
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    await userEvent.click(screen.getByRole("button", { name: "Find photo spots" }));
    await screen.findByTestId("suggestion-card");
    await userEvent.click(screen.getByRole("button", { name: "click first suggestion" }));
    expect((await screen.findByAltText("Photo of Tunnel View")).getAttribute("src")).toBe("https://upload.wikimedia.org/tv.jpg");
    await userEvent.click(screen.getByRole("button", { name: "Add stop" }));
    expect(api.addStop).toHaveBeenCalledWith("t1", { name: "Tunnel View", lat: 37.7, lng: -119.7, source: "suggested", lightPref: "golden" });
    await waitFor(() => expect(screen.queryAllByTestId("suggestion-card")).toHaveLength(0));
  });

  it("opens a stop card from its marker, toggles visited, and opens the details drawer", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.updateStop).mockResolvedValue({ stop: { ...seed[0], visited: true } });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await userEvent.click(screen.getByRole("button", { name: "click first marker" }));
    const card = await screen.findByRole("region", { name: "Selected stop" });
    await userEvent.click(within(card).getByLabelText("Visited"));
    expect(api.updateStop).toHaveBeenCalledWith("a", { visited: true });
    await userEvent.click(within(card).getByRole("button", { name: "Open details" }));
    expect(await screen.findByRole("dialog", { name: "Edit A" })).toBeTruthy();
  });

  describe("alternatives", () => {
    const sug = (n: number, over: Partial<import("@/lib/types").Suggestion> = {}) => ({ osmId: `node/${n}`, name: `Spot ${n}`, lat: 36.8 + n * 0.01, lng: -119.7, kind: "viewpoint" as const, ...over });
    async function openFirstDrawer() {
      await userEvent.click(screen.getByRole("button", { name: "click first marker" }));
      const card = await screen.findByRole("region", { name: "Selected stop" });
      await userEvent.click(within(card).getByRole("button", { name: "Open details" }));
      return screen.findByRole("dialog", { name: "Edit A" });
    }

    it("lists up to 8 nearby alternatives (10 km), leaving out spots on top of a stop", async () => {
      vi.mocked(api.directions).mockResolvedValue({ route });
      vi.mocked(api.placePhoto).mockResolvedValue({ photo: null });
      const many = Array.from({ length: 12 }, (_, i) => sug(i + 1));
      // The first result sits on stop B and the second on stop A itself.
      vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [sug(90, { lat: 37.96, lng: -119.12 }), sug(91, { lat: 36.74, lng: -119.79 }), ...many] });
      render(<TripEditor initialTrip={withStops(seed)} />);
      const dialog = await openFirstDrawer();
      await userEvent.click(within(dialog).getByRole("button", { name: "Find alternatives" }));
      await waitFor(() => expect(within(dialog).getAllByTestId("alternative-card")).toHaveLength(8));
      expect(api.suggestions).toHaveBeenLastCalledWith({ around: [-119.79, 36.74], radiusKm: 10 });
      expect(within(dialog).getAllByTestId("alternative-name")[0].textContent).toBe("Spot 1");
      expect(within(dialog).queryByText("Spot 90")).toBeNull();
      expect(within(dialog).queryByText("Spot 91")).toBeNull();
    });

    it("swaps a stop in place (no photo, not visited), then undoes it", async () => {
      vi.mocked(api.directions).mockResolvedValue({ route });
      vi.mocked(api.placePhoto).mockResolvedValue({ photo: null });
      vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [sug(1, { name: "Glacier Point", lat: 37.73, lng: -119.57 })] });
      const withPhoto = [newStop({ ...seed[0], photoUrl: "/api/uploads/x.png", visited: true, notes: "ND filter" }), seed[1]];
      render(<TripEditor initialTrip={withStops(withPhoto)} />);
      const dialog = await openFirstDrawer();
      await userEvent.click(within(dialog).getByRole("button", { name: "Find alternatives" }));
      vi.mocked(api.updateStop).mockResolvedValueOnce({ stop: { ...withPhoto[0], name: "Glacier Point", lat: 37.73, lng: -119.57, source: "suggested", visited: false, photoUrl: null } });
      await userEvent.click(await within(dialog).findByRole("button", { name: "Swap in Glacier Point" }));
      expect(api.updateStop).toHaveBeenLastCalledWith("a", { name: "Glacier Point", lat: 37.73, lng: -119.57, source: "suggested", visited: false, photoUrl: null });
      const note = await screen.findByTestId("swap-note");
      expect(note.textContent).toContain("Swapped A for Glacier Point");
      expect(note.textContent).toContain("reference photo removed");
      expect(screen.queryByRole("dialog")).toBeNull();
      // Same slot, new place, and the route is asked for again with the new waypoint.
      expect(screen.getAllByTestId("stop-row")[0].textContent).toContain("Glacier Point");
      await waitFor(() => expect(api.directions).toHaveBeenLastCalledWith([[-119.57, 37.73], [-119.12, 37.96]]));

      vi.mocked(api.updateStop).mockResolvedValueOnce({ stop: { ...withPhoto[0], photoUrl: null } });
      await userEvent.click(within(note).getByRole("button", { name: "Undo swap" }));
      expect(api.updateStop).toHaveBeenLastCalledWith("a", { name: "A", lat: 36.74, lng: -119.79, source: "manual", visited: true });
      await waitFor(() => expect(screen.getAllByTestId("stop-row")[0].textContent).toContain("A"));
      expect(screen.queryByTestId("swap-note")).toBeNull();
    });

    it("offers Undo only while the swapped stop is untouched: a later rename or tick removes it", async () => {
      vi.mocked(api.directions).mockResolvedValue({ route });
      vi.mocked(api.placePhoto).mockResolvedValue({ photo: null });
      vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [sug(1, { name: "Glacier Point", lat: 37.73, lng: -119.57 })] });
      render(<TripEditor initialTrip={withStops(seed)} />);
      const dialog = await openFirstDrawer();
      await userEvent.click(within(dialog).getByRole("button", { name: "Find alternatives" }));
      const swappedStop = { ...seed[0], name: "Glacier Point", lat: 37.73, lng: -119.57, source: "suggested" as const, visited: false };
      vi.mocked(api.updateStop).mockResolvedValueOnce({ stop: swappedStop });
      await userEvent.click(await within(dialog).findByRole("button", { name: "Swap in Glacier Point" }));
      expect(await screen.findByTestId("swap-note")).toBeTruthy();
      // Tick Visited and rename (as the drawer would): the stop is no longer what the swap wrote.
      vi.mocked(api.updateStop).mockResolvedValueOnce({ stop: { ...swappedStop, visited: true } });
      await userEvent.click(screen.getByRole("button", { name: "click first marker" }));
      const card = await screen.findByRole("region", { name: "Selected stop" });
      await userEvent.click(within(card).getByLabelText("Visited"));
      await waitFor(() => expect(screen.queryByTestId("swap-note")).toBeNull());
    });

    it("retires Undo once a photo was added to the swapped stop", async () => {
      vi.mocked(api.directions).mockResolvedValue({ route });
      vi.mocked(api.placePhoto).mockResolvedValue({ photo: null });
      vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [sug(1, { name: "Glacier Point", lat: 37.73, lng: -119.57 })] });
      vi.mocked(api.uploadPhoto).mockResolvedValue({ stop: { ...seed[0], name: "Glacier Point", lat: 37.73, lng: -119.57, source: "suggested", photoUrl: "/api/uploads/new.png" } });
      render(<TripEditor initialTrip={withStops(seed)} />);
      let dialog = await openFirstDrawer();
      await userEvent.click(within(dialog).getByRole("button", { name: "Find alternatives" }));
      vi.mocked(api.updateStop).mockResolvedValueOnce({ stop: { ...seed[0], name: "Glacier Point", lat: 37.73, lng: -119.57, source: "suggested", visited: false } });
      await userEvent.click(await within(dialog).findByRole("button", { name: "Swap in Glacier Point" }));
      expect(await screen.findByTestId("swap-note")).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "click first marker" }));
      await userEvent.click(within(await screen.findByRole("region", { name: "Selected stop" })).getByRole("button", { name: "Open details" }));
      dialog = await screen.findByRole("dialog", { name: "Edit Glacier Point" });
      await userEvent.upload(within(dialog).getByLabelText("Upload photo"), new File(["x"], "p.png", { type: "image/png" }));
      await waitFor(() => expect(screen.queryByTestId("swap-note")).toBeNull());
    });

    it("closes the stop's open drawer when the swap is undone", async () => {
      vi.mocked(api.directions).mockResolvedValue({ route });
      vi.mocked(api.placePhoto).mockResolvedValue({ photo: null });
      vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [sug(1, { name: "Glacier Point", lat: 37.73, lng: -119.57 })] });
      render(<TripEditor initialTrip={withStops(seed)} />);
      let dialog = await openFirstDrawer();
      await userEvent.click(within(dialog).getByRole("button", { name: "Find alternatives" }));
      const swappedStop = { ...seed[0], name: "Glacier Point", lat: 37.73, lng: -119.57, source: "suggested" as const, visited: false };
      vi.mocked(api.updateStop).mockResolvedValueOnce({ stop: swappedStop });
      await userEvent.click(await within(dialog).findByRole("button", { name: "Swap in Glacier Point" }));
      const note = await screen.findByTestId("swap-note");
      await userEvent.click(screen.getByRole("button", { name: "click first marker" }));
      await userEvent.click(within(await screen.findByRole("region", { name: "Selected stop" })).getByRole("button", { name: "Open details" }));
      dialog = await screen.findByRole("dialog", { name: "Edit Glacier Point" });
      await userEvent.type(within(dialog).getByLabelText("Notes"), "unsaved");
      vi.mocked(api.updateStop).mockResolvedValueOnce({ stop: seed[0] });
      await userEvent.click(within(note).getByRole("button", { name: "Undo swap" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("blocks Swap in while the drawer has unsaved edits", async () => {
      vi.mocked(api.directions).mockResolvedValue({ route });
      vi.mocked(api.placePhoto).mockResolvedValue({ photo: null });
      vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [sug(1, { name: "Glacier Point" })] });
      render(<TripEditor initialTrip={withStops(seed)} />);
      const dialog = await openFirstDrawer();
      await userEvent.click(within(dialog).getByRole("button", { name: "Find alternatives" }));
      const swapBtn = await within(dialog).findByRole("button", { name: "Swap in Glacier Point" });
      expect((swapBtn as HTMLButtonElement).disabled).toBe(false);
      await userEvent.type(within(dialog).getByLabelText("Notes"), "ND filter");
      expect((swapBtn as HTMLButtonElement).disabled).toBe(true);
      expect(within(dialog).getByText(/Save or close your edits/)).toBeTruthy();
    });

    it("ignores a slow alternatives answer for a stop that is no longer open", async () => {
      vi.mocked(api.directions).mockResolvedValue({ route });
      vi.mocked(api.placePhoto).mockResolvedValue({ photo: null });
      vi.mocked(api.reorderStops).mockResolvedValue({ stops: [{ ...seed[1], order: 0 }, { ...seed[0], order: 1 }] });
      let resolveA!: (v: { suggestions: ReturnType<typeof sug>[] }) => void;
      vi.mocked(api.suggestions).mockImplementationOnce(() => new Promise((r) => { resolveA = r; }));
      render(<TripEditor initialTrip={withStops(seed)} />);
      let dialog = await openFirstDrawer();
      await userEvent.click(within(dialog).getByRole("button", { name: "Find alternatives" }));
      await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      await userEvent.click(screen.getByRole("button", { name: "reorder" })); // B is now first
      await waitFor(() => expect(screen.getByTestId("first-stop").textContent).toBe("37.96,-119.12"));
      await userEvent.click(screen.getByRole("button", { name: "click first marker" }));
      const card = await screen.findByRole("region", { name: "Selected stop" });
      await userEvent.click(within(card).getByRole("button", { name: "Open details" }));
      dialog = await screen.findByRole("dialog", { name: "Edit B" });
      vi.mocked(api.suggestions).mockResolvedValueOnce({ suggestions: [sug(2, { name: "Near B" })] });
      await userEvent.click(within(dialog).getByRole("button", { name: "Find alternatives" }));
      await within(dialog).findByText("Near B");
      await act(async () => resolveA({ suggestions: [sug(1, { name: "Near A" })] }));
      expect(within(dialog).queryByText("Near A")).toBeNull();
      expect(within(dialog).getByText("Near B")).toBeTruthy();
    });

    it("keeps the stop and shows the error when the swap fails", async () => {
      vi.mocked(api.directions).mockResolvedValue({ route });
      vi.mocked(api.placePhoto).mockResolvedValue({ photo: null });
      vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [sug(1, { name: "Glacier Point" })] });
      render(<TripEditor initialTrip={withStops(seed)} />);
      const dialog = await openFirstDrawer();
      await userEvent.click(within(dialog).getByRole("button", { name: "Find alternatives" }));
      vi.mocked(api.updateStop).mockRejectedValueOnce(new Error("nope"));
      await userEvent.click(await within(dialog).findByRole("button", { name: "Swap in Glacier Point" }));
      expect(await screen.findByText("nope")).toBeTruthy();
      expect(screen.queryByTestId("swap-note")).toBeNull();
      expect(screen.getAllByTestId("stop-row")[0].textContent).toContain("A");
    });
  });

  it("saves a dragged marker's coordinates and reverts with an error if it fails", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.updateStop).mockResolvedValueOnce({ stop: { ...seed[0], lat: 38, lng: -118 } });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await userEvent.click(screen.getByRole("button", { name: "drag first marker" }));
    expect(api.updateStop).toHaveBeenCalledWith("a", { lat: 38, lng: -118 });
    await waitFor(() => expect(api.directions).toHaveBeenLastCalledWith([[-118, 38], [-119.12, 37.96]]));

    expect(screen.getByTestId("first-stop").textContent).toBe("38,-118");
    vi.mocked(api.updateStop).mockRejectedValueOnce(new Error("Couldn't update the stop"));
    await userEvent.click(screen.getByRole("button", { name: "drag first marker elsewhere" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't update the stop");
    expect(screen.getByTestId("first-stop").textContent).toBe("38,-118");
    await waitFor(() => expect(api.directions).toHaveBeenLastCalledWith([[-118, 38], [-119.12, 37.96]]));
  });

  it("toggles visited through the API from the list", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    const existing = newStop({});
    vi.mocked(api.updateStop).mockResolvedValue({ stop: { ...existing, visited: true } });
    render(<TripEditor initialTrip={withStops([existing])} />);
    await userEvent.click(screen.getByLabelText("Visited"));
    expect(api.updateStop).toHaveBeenCalledWith("s1", { visited: true });
    await waitFor(() => expect((screen.getByLabelText("Visited") as HTMLInputElement).checked).toBe(true));
  });

  it("reverts an optimistic reorder when the API rejects", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    const stop1 = newStop({ id: "s1", order: 0, name: "Pin 1" });
    const stop2 = newStop({ id: "s2", order: 1, name: "Pin 2", lat: 37.6, lng: -119.6 });
    let rejectReorder!: (e: Error) => void;
    vi.mocked(api.reorderStops).mockImplementation(() => new Promise((_resolve, reject) => { rejectReorder = reject; }));
    render(<TripEditor initialTrip={withStops([stop1, stop2])} />);
    await userEvent.click(screen.getByRole("button", { name: "reorder" }));
    await waitFor(() => expect(screen.getAllByTestId("stop-row")[0].textContent).toContain("1. Pin 2"));
    expect(api.reorderStops).toHaveBeenCalledWith("t1", ["s2", "s1"]);
    await act(async () => { rejectReorder(new Error("Couldn't save the new order")); });
    await waitFor(() => expect(screen.getAllByTestId("stop-row")[0].textContent).toContain("1. Pin 1"));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't save the new order");
  });

  it("preserves a concurrent stop update when an in-flight reorder is later reverted", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    const stop1 = newStop({ id: "s1", order: 0, name: "Pin 1" });
    const stop2 = newStop({ id: "s2", order: 1, name: "Pin 2", lat: 37.6, lng: -119.6 });
    let rejectReorder!: (e: Error) => void;
    vi.mocked(api.reorderStops).mockImplementation(() => new Promise((_resolve, reject) => { rejectReorder = reject; }));
    vi.mocked(api.updateStop).mockResolvedValue({ stop: { ...stop1, visited: true } });
    render(<TripEditor initialTrip={withStops([stop1, stop2])} />);
    await userEvent.click(screen.getByRole("button", { name: "reorder" }));
    await waitFor(() => expect(screen.getAllByTestId("stop-row")[0].textContent).toContain("1. Pin 2"));
    const pin1Row = screen.getAllByTestId("stop-row").find((r) => r.textContent?.includes("Pin 1"))!;
    await userEvent.click(within(pin1Row).getByLabelText("Visited"));
    await waitFor(() => {
      const row = screen.getAllByTestId("stop-row").find((r) => r.textContent?.includes("Pin 1"))!;
      expect((within(row).getByLabelText("Visited") as HTMLInputElement).checked).toBe(true);
    });
    await act(async () => { rejectReorder(new Error("Couldn't save the new order")); });
    await waitFor(() => expect(screen.getAllByTestId("stop-row")[0].textContent).toContain("1. Pin 1"));
    const after = screen.getAllByTestId("stop-row").find((r) => r.textContent?.includes("Pin 1"))!;
    expect((within(after).getByLabelText("Visited") as HTMLInputElement).checked).toBe(true);
  });

  it("keeps the latest order when a slower stop patch returns a stale copy", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    const stop1 = newStop({ id: "s1", order: 0, name: "Pin 1" });
    const stop2 = newStop({ id: "s2", order: 1, name: "Pin 2", lat: 37.6, lng: -119.6 });
    let resolvePatch!: (v: { stop: Stop }) => void;
    vi.mocked(api.updateStop).mockImplementation(() => new Promise((r) => { resolvePatch = r; }));
    render(<TripEditor initialTrip={withStops([stop1, stop2])} />);
    const pin1Row = () => screen.getAllByTestId("stop-row").find((r) => r.textContent?.includes("Pin 1"))!;
    await userEvent.click(within(pin1Row()).getByLabelText("Visited"));
    vi.mocked(api.reorderStops).mockResolvedValueOnce({ stops: [{ ...stop2, order: 0 }, { ...stop1, order: 1 }] });
    await userEvent.click(screen.getByRole("button", { name: "reorder" }));
    await waitFor(() => expect(screen.getAllByTestId("stop-row")[0].textContent).toContain("1. Pin 2"));
    await act(async () => { resolvePatch({ stop: { ...stop1, order: 0, visited: true } }); });
    // A second reorder that fails must revert to the order the server confirmed, not the stale one.
    vi.mocked(api.reorderStops).mockRejectedValueOnce(new Error("Couldn't save the new order"));
    await userEvent.click(screen.getByRole("button", { name: "reorder" }));
    await screen.findByRole("alert");
    expect(screen.getAllByTestId("stop-row")[0].textContent).toContain("1. Pin 2");
    expect((within(pin1Row()).getByLabelText("Visited") as HTMLInputElement).checked).toBe(true);
  });

  it("downsamples a long route before asking for suggestions", async () => {
    const geometry = Array.from({ length: 3000 }, (_, i) => [-119.79 + i * 0.0002, 36.74 + i * 0.0004] as [number, number]);
    vi.mocked(api.directions).mockResolvedValue({ route: { ...route, geometry } });
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [] });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toMatch(/\d mi\b/));
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    await userEvent.click(screen.getByRole("button", { name: "Find photo spots" }));
    await waitFor(() => expect(api.suggestions).toHaveBeenCalled());
    const sent = vi.mocked(api.suggestions).mock.calls[0]![0] as [number, number][];
    expect(sent.length).toBeLessThanOrEqual(1500);
    expect(sent[0]).toEqual(geometry[0]);
    expect(sent[sent.length - 1]).toEqual(geometry[2999]);
  });

  it("clears suggestions when the stops change and ignores a late response for the old stops", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    let resolveLate!: (v: { suggestions: import("@/lib/types").Suggestion[] }) => void;
    vi.mocked(api.suggestions).mockResolvedValueOnce({ suggestions: [{ osmId: "node/1", name: "Tunnel View", lat: 37.7, lng: -119.7, kind: "viewpoint" }] });
    vi.mocked(api.updateStop).mockResolvedValue({ stop: { ...seed[0], lat: 38, lng: -118 } });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toMatch(/\d mi\b/));
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    await userEvent.click(screen.getByRole("button", { name: "Find photo spots" }));
    await screen.findByTestId("suggestion-card");
    await userEvent.click(screen.getByRole("button", { name: "drag first marker" }));
    await waitFor(() => expect(screen.queryAllByTestId("suggestion-card")).toHaveLength(0));

    // A request started before the stops change must not land afterwards.
    vi.mocked(api.suggestions).mockImplementationOnce(() => new Promise((r) => { resolveLate = r; }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Find photo spots" }) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(screen.getByRole("button", { name: "Find photo spots" }));
    vi.mocked(api.updateStop).mockResolvedValue({ stop: { ...seed[0], lat: 39, lng: -117 } });
    await userEvent.click(screen.getByRole("button", { name: "drag first marker elsewhere" }));
    await act(async () => { resolveLate({ suggestions: [{ osmId: "node/2", name: "Late", lat: 37.8, lng: -119.6, kind: "viewpoint" }] }); });
    expect(screen.queryAllByTestId("suggestion-card")).toHaveLength(0);
  });

  it("does not stay on Searching when the stops change and revert while a search is in flight", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    let resolveSearch!: (v: { suggestions: import("@/lib/types").Suggestion[] }) => void;
    let rejectMove!: (e: Error) => void;
    vi.mocked(api.suggestions).mockImplementationOnce(() => new Promise((r) => { resolveSearch = r; }));
    vi.mocked(api.updateStop).mockImplementation(() => new Promise((_r, reject) => { rejectMove = reject; }));
    render(<TripEditor initialTrip={withStops(seed)} />);
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toMatch(/\d mi\b/));
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    await userEvent.click(screen.getByRole("button", { name: "Find photo spots" }));
    await userEvent.click(screen.getByRole("button", { name: "drag first marker" }));
    await act(async () => { resolveSearch({ suggestions: [] }); });
    await act(async () => { rejectMove(new Error("nope")); });
    await waitFor(() => expect(screen.getByTestId("first-stop").textContent).toBe("36.74,-119.79"));
    await waitFor(() => expect(screen.queryByText("Searching…")).toBeNull());
  });

  it("keeps a newer drawer open when an earlier delete finishes", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let resolveDelete!: () => void;
    vi.mocked(api.deleteStop).mockImplementation(() => new Promise<void>((r) => { resolveDelete = r; }) as never);
    render(<TripEditor initialTrip={withStops(seed)} />);
    await userEvent.click(screen.getByRole("button", { name: "2. B" }));
    expect(await screen.findByRole("dialog", { name: "Edit B" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Delete B" }));
    await userEvent.click(screen.getByRole("button", { name: "1. A" }));
    expect(await screen.findByRole("dialog", { name: "Edit A" })).toBeTruthy();
    await act(async () => { resolveDelete(); });
    await waitFor(() => expect(screen.getAllByTestId("stop-row")).toHaveLength(1));
    expect(screen.getByRole("dialog", { name: "Edit A" })).toBeTruthy();
  });

  it("treats deleting a stop that is already gone (404) as success", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.deleteStop).mockRejectedValue(Object.assign(new Error("Stop not found"), { status: 404 }));
    render(<TripEditor initialTrip={withStops(seed)} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete B" }));
    await waitFor(() => expect(screen.getAllByTestId("stop-row")).toHaveLength(1));
    expect(screen.queryByText("Stop not found")).toBeNull();
  });

  it("shows the reload message when a reorder is rejected as stale (409)", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.reorderStops).mockRejectedValue(Object.assign(new Error("The trip's stops changed; reload and try again"), { status: 409 }));
    render(<TripEditor initialTrip={withStops(seed)} />);
    await userEvent.click(screen.getByRole("button", { name: "reorder" }));
    expect(await screen.findByText(/reload and try again/)).toBeTruthy();
    expect(screen.getAllByTestId("stop-row").map((r) => r.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("A")]));
  });

  it("keeps the other suggestions after accepting one", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [
      { osmId: "node/1", name: "Tunnel View", lat: 37.7, lng: -119.7, kind: "viewpoint" },
      { osmId: "node/2", name: "Glacier Point", lat: 37.73, lng: -119.57, kind: "viewpoint" },
    ] });
    vi.mocked(api.addStop).mockResolvedValue({ stop: newStop({ id: "c", order: 2, name: "Tunnel View", source: "suggested", lat: 37.7, lng: -119.7 }) });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toMatch(/\d mi\b/));
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    await userEvent.click(screen.getByRole("button", { name: "Find photo spots" }));
    await userEvent.click((await screen.findAllByRole("button", { name: /^Accept/ }))[0]!);
    await waitFor(() => expect(api.directions).toHaveBeenCalledTimes(2));
    expect(screen.getAllByTestId("suggestion-name").map((e) => e.textContent)).toEqual(["Glacier Point"]);
  });

  describe("optimize route", () => {
    const three = [
      newStop({ id: "a", order: 0, name: "A", lat: 36, lng: -119 }),
      newStop({ id: "b", order: 1, name: "B", lat: 38, lng: -119 }),
      newStop({ id: "c", order: 2, name: "C", lat: 37, lng: -119 }),
    ];
    const rowNames = () => screen.getAllByTestId("stop-row").map((r) => r.textContent ?? "");
    const reorderEcho = () =>
      vi.mocked(api.reorderStops).mockImplementation(async (_t, ids) => ({
        stops: ids.map((id, order) => ({ ...three.find((s) => s.id === id)!, order })),
      }));
    beforeEach(() => vi.mocked(api.directions).mockResolvedValue({ route }));

    it("is disabled until there are three stops", () => {
      render(<TripEditor initialTrip={withStops(seed)} />);
      expect((screen.getByRole("button", { name: "Optimize route" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("sends the coordinates, applies the order through reorder, and offers Undo", async () => {
      reorderEcho();
      vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 2, 1] });
      const user = userEvent.setup();
      render(<TripEditor initialTrip={withStops(three)} />);
      await user.click(screen.getByRole("button", { name: "Optimize route" }));
      expect(api.optimizeOrder).toHaveBeenCalledWith([[-119, 36], [-119, 38], [-119, 37]], {
        stops: [30, 30, 30].map((dwellMinutes) => ({ lightPref: "any", priority: "normal", dwellMinutes })),
        plannedDate: "2026-07-01",
      });
      await waitFor(() => expect(api.reorderStops).toHaveBeenCalledWith("t1", ["a", "c", "b"]));
      await waitFor(() => expect(rowNames()[1]).toContain("C"));

      await user.click(await screen.findByRole("button", { name: "Undo" }));
      await waitFor(() => expect(api.reorderStops).toHaveBeenLastCalledWith("t1", ["a", "b", "c"]));
      await waitFor(() => expect(rowNames()[1]).toContain("B"));
      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    });

    describe("with light preferences", () => {
      const sunsetC = [three[0], three[1], { ...three[2], lightPref: "sunset" as const }];
      const trip2 = (departAt: string | null) => ({ ...withStops(sunsetC), departAt });
      const echoTrip = () =>
        vi.mocked(api.updateTrip).mockImplementation(async (_id, patch) => ({ trip: { ...trip2(null), ...patch } as never }));

      it("sends the preferences, saves the new departure, shows Starts, and Undo restores both", async () => {
        reorderEcho();
        echoTrip();
        vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 2, 1], departAt: "2026-07-01T23:15:00.000Z", misses: [] });
        const user = userEvent.setup();
        render(<TripEditor initialTrip={trip2(null)} />);
        await user.click(screen.getByRole("button", { name: "Optimize route" }));
        expect(vi.mocked(api.optimizeOrder).mock.calls[0]![1]!.stops[2]).toEqual({ lightPref: "sunset", priority: "normal", dwellMinutes: 30 });
        await waitFor(() => expect(api.updateTrip).toHaveBeenCalledWith("t1", { departAt: "2026-07-01T23:15:00.000Z" }));
        expect(((await screen.findByLabelText("Start time")) as HTMLInputElement).value).toMatch(/^\d{2}:\d{2}$/);
        expect(screen.getByRole("button", { name: "Reset to now" })).toBeTruthy();

        await user.click(await screen.findByRole("button", { name: "Undo" }));
        await waitFor(() => expect(api.updateTrip).toHaveBeenLastCalledWith("t1", { departAt: null }));
        await waitFor(() => expect(api.reorderStops).toHaveBeenLastCalledWith("t1", ["a", "b", "c"]));
        await waitFor(() => expect(screen.queryByRole("button", { name: "Reset to now" })).toBeNull());
        expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toMatch(/^\d{2}:\d{2}$/); // back to now
      });

      it("never saves a start time outside the planned day: the optimizer's pick is clamped, and the move is announced", async () => {
        echoTrip();
        // 2026-07-02 09:00Z is 01:07 on July 2 at -119 degrees: a neighbouring solar day, which the server would refuse.
        vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 1, 2], departAt: "2026-07-02T09:00:00.000Z", misses: [] });
        const user = userEvent.setup();
        render(<TripEditor initialTrip={trip2(null)} />);
        await user.click(screen.getByRole("button", { name: "Optimize route" }));
        await waitFor(() => expect(api.updateTrip).toHaveBeenCalledTimes(1));
        const sent = vi.mocked(api.updateTrip).mock.calls[0]![1].departAt as string;
        expect(solarDateAt(new Date(sent), -119)).toBe("2026-07-01");
        await waitFor(() => expect(screen.getByTestId("optimize-status").textContent).toMatch(/^Start time moved to /));
      });

      it("keeps an unchanged order but still applies a new departure", async () => {
        echoTrip();
        vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 1, 2], departAt: "2026-07-01T23:15:00.000Z", misses: [] });
        const user = userEvent.setup();
        render(<TripEditor initialTrip={trip2(null)} />);
        await user.click(screen.getByRole("button", { name: "Optimize route" }));
        await waitFor(() => expect(api.updateTrip).toHaveBeenCalledTimes(1));
        expect(api.reorderStops).not.toHaveBeenCalled();
        expect(await screen.findByRole("button", { name: "Undo" })).toBeTruthy();
        await waitFor(() => expect(screen.getByTestId("optimize-status").textContent).toMatch(/^Start time moved to /));
        expectOptimizeNoteHidden();
      });

      it("sends the saved start time and, when the answer is the same moment, keeps it without a 'moved' note", async () => {
        echoTrip();
        vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 1, 2], departAt: "2026-07-02T00:22:00.000Z", misses: [] });
        const user = userEvent.setup();
        render(<TripEditor initialTrip={trip2("2026-07-02T00:22:00Z")} />);
        await user.click(screen.getByRole("button", { name: "Optimize route" }));
        await waitFor(() => expect(screen.getByTestId("optimize-status").textContent).toContain("Already the fastest order"));
        expectOptimizeNoteHidden();
        expect(vi.mocked(api.optimizeOrder).mock.calls[0]![1]!.departAt).toBe("2026-07-02T00:22:00Z");
        expect(api.updateTrip).not.toHaveBeenCalled();
        expect(screen.queryByText(/Start time moved/)).toBeNull();
      });

      it("lists the stops that miss their light", async () => {
        reorderEcho();
        echoTrip();
        vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 2, 1], departAt: null, misses: [{ stopIndex: 2, minutes: 90 }, { stopIndex: 1, minutes: 20 }] });
        const user = userEvent.setup();
        render(<TripEditor initialTrip={trip2(null)} />);
        await user.click(screen.getByRole("button", { name: "Optimize route" }));
        await waitFor(() => expect(screen.getByTestId("optimize-status").textContent).toContain("Can't fit 2 stops in their light: C, B."));
        expectOptimizeNoteHidden();
        expect(api.updateTrip).not.toHaveBeenCalled(); // null departAt leaves the departure alone
      });

      it("resets a chosen departure back to sunrise", async () => {
        echoTrip();
        const user = userEvent.setup();
        render(<TripEditor initialTrip={trip2("2026-07-01T23:15:00.000Z")} />);
        expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toMatch(/^\d{2}:\d{2}$/);
        expect(screen.queryByTestId("depart-note")).toBeNull();
        await user.click(screen.getByRole("button", { name: "Reset to now" }));
        await waitFor(() => expect(api.updateTrip).toHaveBeenCalledWith("t1", { departAt: null }));
        await waitFor(() => expect(screen.queryByRole("button", { name: "Reset to now" })).toBeNull());
      });
    });

    it("says so instead of saving when the order is already fastest", async () => {
      vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 1, 2] });
      const user = userEvent.setup();
      render(<TripEditor initialTrip={withStops(three)} />);
      await user.click(screen.getByRole("button", { name: "Optimize route" }));
      await waitFor(() => expect(screen.getByTestId("optimize-status").textContent).toContain("Already the fastest order"));
      expectOptimizeNoteHidden();
      expect(api.reorderStops).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    });

    it("says 'No faster order found' where the answer came from a heuristic, by stop count", async () => {
      const many = (n: number) => Array.from({ length: n }, (_, i) => newStop({ id: `s${i}`, order: i, name: `S${i}`, lat: 36 + i * 0.1, lng: -119 }));
      for (const [n, sunset, text] of [[13, false, "No faster order found"], [12, false, "Already the fastest order"], [9, true, "No faster order found"], [8, true, "Already the fastest order"]] as const) {
        vi.mocked(api.optimizeOrder).mockResolvedValue({ order: Array.from({ length: n }, (_, i) => i), ...(sunset ? { departAt: null, misses: [] } : {}) });
        const stops = many(n).map((s, i) => (sunset && i === n - 1 ? { ...s, lightPref: "sunset" as const } : s));
        const user = userEvent.setup();
        const { unmount } = render(<TripEditor initialTrip={withStops(stops)} />);
        await user.click(screen.getByRole("button", { name: "Optimize route" }));
        await waitFor(() => expect(screen.getByTestId("optimize-status").textContent, `${n} stops`).toContain(text));
        unmount();
      }
    });

    it("does not bring a stale Undo back when the stops are dragged into the applied order again", async () => {
      reorderEcho();
      vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 2, 1] });
      const user = userEvent.setup();
      render(<TripEditor initialTrip={withStops(three)} />);
      await user.click(screen.getByRole("button", { name: "Optimize route" }));
      await screen.findByRole("button", { name: "Undo" });
      await user.click(screen.getByRole("button", { name: "reorder" })); // a, c, b -> b, c, a
      await waitFor(() => expect(rowNames()[0]).toContain("B"));
      await user.click(screen.getByRole("button", { name: "reorder" })); // back to a, c, b
      await waitFor(() => expect(rowNames()[0]).toContain("A"));
      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    });

    it("sends one start-time save when Undo is clicked twice while it is saving", async () => {
      const sunsetC = [three[0], three[1], { ...three[2], lightPref: "sunset" as const }];
      const lit = { ...withStops(sunsetC), departAt: null };
      vi.mocked(api.updateTrip).mockImplementation(async (_id, patch) => ({ trip: { ...lit, ...patch } as never }));
      vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 1, 2], departAt: "2026-07-01T23:15:00.000Z", misses: [] });
      const user = userEvent.setup();
      render(<TripEditor initialTrip={lit} />);
      await user.click(screen.getByRole("button", { name: "Optimize route" }));
      const undoButton = await screen.findByRole("button", { name: "Undo" });
      let release!: () => void;
      vi.mocked(api.updateTrip).mockImplementationOnce(
        (_id, patch) => new Promise((res) => (release = () => res({ trip: { ...lit, ...patch } as never }))),
      );
      await user.click(undoButton);
      expect((undoButton as HTMLButtonElement).disabled).toBe(true);
      await user.click(undoButton);
      await act(async () => release());
      expect(api.updateTrip).toHaveBeenCalledTimes(2); // the optimize and one undo
    });

    it("shows the server's error and ignores a second click while busy", async () => {
      let rejectIt!: (e: Error) => void;
      vi.mocked(api.optimizeOrder).mockReturnValue(new Promise((_, rej) => (rejectIt = rej)));
      const user = userEvent.setup();
      render(<TripEditor initialTrip={withStops(three)} />);
      await user.click(screen.getByRole("button", { name: "Optimize route" }));
      const busy = screen.getByRole("button", { name: "Optimizing…" });
      expect((busy as HTMLButtonElement).disabled).toBe(true);
      await user.click(busy);
      expect(api.optimizeOrder).toHaveBeenCalledTimes(1);
      await act(async () => rejectIt(new Error("Couldn't calculate drive times. Please try again.")));
      expect((await screen.findByRole("alert")).textContent).toContain("Couldn't calculate drive times");
      expect((screen.getByRole("button", { name: "Optimize route" }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("keeps a Visited tick made while optimizing is in flight", async () => {
      let resolveIt!: (v: { order: number[] }) => void;
      vi.mocked(api.optimizeOrder).mockReturnValue(new Promise((res) => (resolveIt = res)));
      reorderEcho();
      vi.mocked(api.updateStop).mockImplementation(async (id, patch) => ({ stop: { ...three.find((s) => s.id === id)!, ...patch } }));
      const user = userEvent.setup();
      render(<TripEditor initialTrip={withStops(three)} />);
      await user.click(screen.getByRole("button", { name: "Optimize route" }));
      const rowB = screen.getAllByTestId("stop-row").find((r) => r.textContent?.includes("B"))!;
      await user.click(within(rowB).getByLabelText("Visited"));
      await waitFor(() => expect(api.updateStop).toHaveBeenCalled());
      await act(async () => resolveIt({ order: [0, 2, 1] }));
      await waitFor(() => expect(rowNames()[1]).toContain("C"));
      const after = screen.getAllByTestId("stop-row").find((r) => r.textContent?.includes("B"))!;
      expect((within(after).getByLabelText("Visited") as HTMLInputElement).checked).toBe(true);
    });

    it("discards the result when the stops changed while it was in flight", async () => {
      let resolveIt!: (v: { order: number[] }) => void;
      vi.mocked(api.optimizeOrder).mockReturnValue(new Promise((res) => (resolveIt = res)));
      reorderEcho();
      const user = userEvent.setup();
      render(<TripEditor initialTrip={withStops(three)} />);
      await user.click(screen.getByRole("button", { name: "Optimize route" }));
      await user.click(screen.getByRole("button", { name: "reorder" })); // manual change mid-flight
      await act(async () => resolveIt({ order: [0, 2, 1] }));
      expect((await screen.findByRole("alert")).textContent).toContain("changed");
      expect(api.reorderStops).toHaveBeenCalledTimes(1); // only the manual one
    });

    it("drops Undo once the user reorders manually", async () => {
      reorderEcho();
      vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 2, 1] });
      const user = userEvent.setup();
      render(<TripEditor initialTrip={withStops(three)} />);
      await user.click(screen.getByRole("button", { name: "Optimize route" }));
      await screen.findByRole("button", { name: "Undo" });
      await user.click(screen.getByRole("button", { name: "reorder" }));
      await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).toBeNull());
    });
  });
});

describe("TripEditor with saved settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [] });
    vi.mocked(api.reverseGeocode).mockResolvedValue({ place: { name: "Tunnel View", lat: 37.5, lng: -119.5 } });
    installMemoryStorage();
  });
  afterEach(() => vi.resetModules());

  async function renderWith(saved: object, initialTrip: TripWithStops) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved));
    vi.resetModules();
    const { SettingsProvider } = await import("@/components/settings/SettingsProvider");
    const { TripEditor: Editor } = await import("./TripEditor");
    render(<SettingsProvider><Editor initialTrip={initialTrip} /></SettingsProvider>);
  }

  it("shows the route distance in miles", async () => {
    const { api: freshApi } = await import("@/lib/api-client");
    vi.mocked(freshApi.suggestions).mockResolvedValue({ suggestions: [] });
    vi.mocked(freshApi.directions).mockResolvedValue({ route });
    await renderWith({ distanceUnit: "mi" }, withStops(seed));
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toBe("62 mi · 1 h 0 min"));
  });

  it("new stops use the default dwell setting", async () => {
    const { api: freshApi } = await import("@/lib/api-client");
    vi.mocked(freshApi.suggestions).mockResolvedValue({ suggestions: [] });
    vi.mocked(freshApi.reverseGeocode).mockResolvedValue({ place: { name: "Tunnel View", lat: 37.5, lng: -119.5 } });
    vi.mocked(freshApi.addStop).mockResolvedValue({ stop: newStop({ id: "c", name: "Tunnel View", dwellMinutes: 90 }) });
    await renderWith({ defaultDwellMinutes: 90 }, trip);
    await userEvent.click(screen.getByText("drop pin"));
    await userEvent.click(await screen.findByRole("button", { name: "Add stop" }));
    expect(freshApi.addStop).toHaveBeenCalledWith("t1", { dwellMinutes: 90, name: "Tunnel View", lat: 37.5, lng: -119.5, source: "manual" });
  });
});
