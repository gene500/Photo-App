// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
  api: {
    directions: vi.fn(), addStop: vi.fn(), suggestions: vi.fn(), reorderStops: vi.fn(),
    updateStop: vi.fn(), deleteStop: vi.fn(), updateTrip: vi.fn(), reverseGeocode: vi.fn(), placePhoto: vi.fn(), geocode: vi.fn(), optimizeOrder: vi.fn(),
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
import { TripEditor } from "./TripEditor";

const trip: TripWithStops = { id: "t1", name: "Sierra loop", plannedDate: "2026-07-01", departAt: null, stops: [] };
const route = { geometry: [[-119.79, 36.74], [-119.12, 37.96]] as [number, number][], legs: [{ distance: 100_000, duration: 3_600 }], distance: 100_000, duration: 3_600 };
const newStop = (over: Partial<Stop>): Stop => ({
  id: "s1", tripId: "t1", order: 0, name: "Pin 1", lat: 37.5, lng: -119.5, notes: null, source: "manual", photoUrl: null, visited: false, lightPref: "any", dwellMinutes: 30, ...over,
});
const seed = [
  newStop({ id: "a", order: 0, name: "A", lat: 36.74, lng: -119.79 }),
  newStop({ id: "b", order: 1, name: "B", lat: 37.96, lng: -119.12 }),
];
const withStops = (stops: Stop[]) => ({ ...trip, stops });

describe("TripEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toBe("100 km · 1 h 0 min"));
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

  it("finds suggestions and accepts one from the Suggestions tab", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [{ osmId: "node/1", name: "Tunnel View", lat: 37.7, lng: -119.7, kind: "viewpoint" }] });
    vi.mocked(api.addStop).mockResolvedValue({ stop: newStop({ id: "c", order: 2, name: "Tunnel View", source: "suggested", lat: 37.7, lng: -119.7 }) });
    vi.mocked(api.placePhoto).mockResolvedValue({ photo: { url: "https://upload.wikimedia.org/tv.jpg", title: "Tunnel View", pageUrl: "https://en.wikipedia.org/wiki/Tunnel_View", credit: "Wikipedia" } });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toContain("km"));
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    await userEvent.click(screen.getByRole("button", { name: "Find photo spots" }));
    await userEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(api.addStop).toHaveBeenCalledWith("t1", { name: "Tunnel View", lat: 37.7, lng: -119.7, source: "suggested", lightPref: "golden" });
    await userEvent.click(screen.getByRole("tab", { name: "Stops" }));
    expect(screen.getAllByTestId("stop-row")[2].textContent).toContain("Tunnel View");
  });

  it("opens a suggestion marker as a pending place and adds it as a suggested stop", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [{ osmId: "node/1", name: "Tunnel View", lat: 37.7, lng: -119.7, kind: "viewpoint" }] });
    vi.mocked(api.addStop).mockResolvedValue({ stop: newStop({ id: "c", order: 2, name: "Tunnel View", source: "suggested", lat: 37.7, lng: -119.7 }) });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toContain("km"));
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
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toContain("km"));
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    await userEvent.click(screen.getByRole("button", { name: "Find photo spots" }));
    await waitFor(() => expect(api.suggestions).toHaveBeenCalled());
    const sent = vi.mocked(api.suggestions).mock.calls[0]![0];
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
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toContain("km"));
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

  it("keeps the other suggestions after accepting one", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [
      { osmId: "node/1", name: "Tunnel View", lat: 37.7, lng: -119.7, kind: "viewpoint" },
      { osmId: "node/2", name: "Glacier Point", lat: 37.73, lng: -119.57, kind: "viewpoint" },
    ] });
    vi.mocked(api.addStop).mockResolvedValue({ stop: newStop({ id: "c", order: 2, name: "Tunnel View", source: "suggested", lat: 37.7, lng: -119.7 }) });
    render(<TripEditor initialTrip={withStops(seed)} />);
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toContain("km"));
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    await userEvent.click(screen.getByRole("button", { name: "Find photo spots" }));
    await userEvent.click((await screen.findAllByRole("button", { name: "Accept" }))[0]!);
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
        stops: [30, 30, 30].map((dwellMinutes) => ({ lightPref: "any", dwellMinutes })),
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
        expect(vi.mocked(api.optimizeOrder).mock.calls[0]![1]!.stops[2]).toEqual({ lightPref: "sunset", dwellMinutes: 30 });
        await waitFor(() => expect(api.updateTrip).toHaveBeenCalledWith("t1", { departAt: "2026-07-01T23:15:00.000Z" }));
        expect((await screen.findByTestId("depart-note")).textContent).toMatch(/^Starts \d{1,2}:\d{2} (AM|PM)$/);

        await user.click(await screen.findByRole("button", { name: "Undo" }));
        await waitFor(() => expect(api.updateTrip).toHaveBeenLastCalledWith("t1", { departAt: null }));
        await waitFor(() => expect(api.reorderStops).toHaveBeenLastCalledWith("t1", ["a", "b", "c"]));
        await waitFor(() => expect(screen.queryByTestId("depart-note")).toBeNull());
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
      });

      it("lists the stops that miss their light", async () => {
        reorderEcho();
        echoTrip();
        vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 2, 1], departAt: null, misses: [{ stopIndex: 2, minutes: 90 }, { stopIndex: 1, minutes: 20 }] });
        const user = userEvent.setup();
        render(<TripEditor initialTrip={trip2(null)} />);
        await user.click(screen.getByRole("button", { name: "Optimize route" }));
        expect(await screen.findByText("Can't fit 2 stops in their light: C, B.")).toBeTruthy();
        expect(api.updateTrip).not.toHaveBeenCalled(); // null departAt leaves the departure alone
      });

      it("resets a chosen departure back to sunrise", async () => {
        echoTrip();
        const user = userEvent.setup();
        render(<TripEditor initialTrip={trip2("2026-07-01T23:15:00.000Z")} />);
        expect(screen.getByTestId("depart-note")).toBeTruthy();
        await user.click(screen.getByRole("button", { name: "Reset to sunrise" }));
        await waitFor(() => expect(api.updateTrip).toHaveBeenCalledWith("t1", { departAt: null }));
        await waitFor(() => expect(screen.queryByTestId("depart-note")).toBeNull());
      });
    });

    it("says so instead of saving when the order is already fastest", async () => {
      vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 1, 2] });
      const user = userEvent.setup();
      render(<TripEditor initialTrip={withStops(three)} />);
      await user.click(screen.getByRole("button", { name: "Optimize route" }));
      expect(await screen.findByText("Already the fastest order")).toBeTruthy();
      expect(api.reorderStops).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
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
