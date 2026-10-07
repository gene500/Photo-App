// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
  api: {
    directions: vi.fn(), addStop: vi.fn(), suggestions: vi.fn(), reorderStops: vi.fn(),
    updateStop: vi.fn(), deleteStop: vi.fn(), updateTrip: vi.fn(), reverseGeocode: vi.fn(), geocode: vi.fn(),
  },
}));
vi.mock("./MapView", () => ({
  MapView: (p: import("./map-types").MapViewProps) => (
    <div>
      <button type="button" onClick={() => p.onMapClick({ lat: 37.5, lng: -119.5 })}>drop pin</button>
      <button type="button" onClick={() => p.stops[0] && p.onStopClick(p.stops[0].id)}>click first marker</button>
      <button type="button" onClick={() => p.stops[0] && p.onStopMove?.(p.stops[0].id, { lat: 38, lng: -118 })}>drag first marker</button>
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

const trip: TripWithStops = { id: "t1", name: "Sierra loop", plannedDate: "2026-07-01", stops: [] };
const route = { geometry: [[-119.79, 36.74], [-119.12, 37.96]] as [number, number][], legs: [{ distance: 100_000, duration: 3_600 }], distance: 100_000, duration: 3_600 };
const newStop = (over: Partial<Stop>): Stop => ({
  id: "s1", tripId: "t1", order: 0, name: "Pin 1", lat: 37.5, lng: -119.5, notes: null, source: "manual", photoUrl: null, visited: false, ...over,
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
    expect(screen.getByTestId("empty-hint")).toBeTruthy();
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
    render(<TripEditor initialTrip={withStops(seed)} />);
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toContain("km"));
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    await userEvent.click(screen.getByRole("button", { name: "Find photo spots" }));
    await userEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(api.addStop).toHaveBeenCalledWith("t1", { name: "Tunnel View", lat: 37.7, lng: -119.7, source: "suggested" });
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
    await userEvent.click(screen.getByRole("button", { name: "Add stop" }));
    expect(api.addStop).toHaveBeenCalledWith("t1", { name: "Tunnel View", lat: 37.7, lng: -119.7, source: "suggested" });
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

    vi.mocked(api.updateStop).mockRejectedValueOnce(new Error("Couldn't update the stop"));
    await userEvent.click(screen.getByRole("button", { name: "drag first marker" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't update the stop");
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
});
