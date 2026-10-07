// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
  api: { directions: vi.fn(), addStop: vi.fn(), suggestions: vi.fn(), reorderStops: vi.fn(), updateStop: vi.fn(), deleteStop: vi.fn(), updateTrip: vi.fn() },
}));
vi.mock("./MapView", () => ({
  MapView: ({ onMapClick }: { onMapClick: (p: { lat: number; lng: number }) => void }) => (
    <button type="button" onClick={() => onMapClick({ lat: 37.5, lng: -119.5 })}>drop pin</button>
  ),
}));
// dnd-kit's drag gestures can't be simulated in jsdom (same reasoning Task 19
// used for StopList's own tests), so the real StopList is kept for rendering
// (stop-row, Visited checkbox, etc.) but wrapped with an extra button that
// invokes the same onReorder callback a real drag-end would.
vi.mock("./StopList", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./StopList")>();
  type Props = Parameters<typeof actual.StopList>[0];
  function StopList(props: Props) {
    return (
      <>
        <button
          type="button"
          onClick={() => props.onReorder([...props.stops].reverse().map((s) => s.id))}
        >
          reorder
        </button>
        <actual.StopList {...props} />
      </>
    );
  }
  return { ...actual, StopList };
});
import { api } from "@/lib/api-client";
import type { Stop, TripWithStops } from "@/lib/types";
import { TripEditor } from "./TripEditor";

const trip: TripWithStops = {
  id: "t1", name: "Sierra loop", plannedDate: "2026-07-01",
  stops: [],
};
const route = { geometry: [[-119.79, 36.74], [-119.12, 37.96]] as [number, number][], legs: [{ distance: 100_000, duration: 3_600 }], distance: 100_000, duration: 3_600 };
const newStop = (over: Partial<Stop>): Stop => ({
  id: "s1", tripId: "t1", order: 0, name: "Pin 1", lat: 37.5, lng: -119.5, notes: null, source: "manual", photoUrl: null, visited: false, ...over,
});

const seed = [
  newStop({ id: "a", order: 0, name: "A", lat: 36.74, lng: -119.79 }),
  newStop({ id: "b", order: 1, name: "B", lat: 37.96, lng: -119.12 }),
];

describe("TripEditor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the route through the stops and shows its summary", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    render(<TripEditor initialTrip={{ ...trip, stops: seed }} />);
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toBe("100 km · 1 h 0 min"));
    expect(api.directions).toHaveBeenCalledWith([[-119.79, 36.74], [-119.12, 37.96]]);
  });

  it("shows a dismissible route error while the rest of the editor keeps working", async () => {
    vi.mocked(api.directions).mockRejectedValue(new Error("No driving route found between these points"));
    vi.mocked(api.addStop).mockResolvedValue({ stop: newStop({}) });
    render(<TripEditor initialTrip={{ ...trip, stops: seed }} />);
    expect((await screen.findByRole("alert")).textContent).toContain("No driving route found");
    expect(screen.getByTestId("route-status").textContent).toBe("Route unavailable");
    await userEvent.click(screen.getByRole("button", { name: "drop pin" }));
    expect(await screen.findAllByTestId("stop-row")).toHaveLength(3);
  });

  it("adds a manual stop when the map is clicked and refetches the route", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.addStop).mockResolvedValue({ stop: newStop({}) });
    render(<TripEditor initialTrip={{ ...trip, stops: [seed[0]!] }} />);
    await userEvent.click(screen.getByRole("button", { name: "drop pin" }));
    expect(api.addStop).toHaveBeenCalledWith("t1", { name: "Pin 2", lat: 37.5, lng: -119.5, source: "manual" });
    await waitFor(() => expect(api.directions).toHaveBeenLastCalledWith([[-119.79, 36.74], [-119.5, 37.5]]));
  });

  it("finds suggestions and accepts one as a suggested stop", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [{ osmId: "node/1", name: "Tunnel View", lat: 37.7, lng: -119.7, kind: "viewpoint" }] });
    vi.mocked(api.addStop).mockResolvedValue({ stop: newStop({ name: "Tunnel View", source: "suggested", lat: 37.7, lng: -119.7 }) });
    render(<TripEditor initialTrip={{ ...trip, stops: seed }} />);
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toContain("km"));
    await userEvent.click(screen.getByRole("button", { name: "Find photo spots" }));
    await userEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(api.addStop).toHaveBeenCalledWith("t1", { name: "Tunnel View", lat: 37.7, lng: -119.7, source: "suggested" });
    await waitFor(() => expect(screen.queryAllByTestId("suggestion-card")).toHaveLength(0));
    expect(screen.getAllByTestId("stop-row")[2].textContent).toContain("Tunnel View");
  });

  it("makes no directions request and prompts for stops on an empty trip", () => {
    render(<TripEditor initialTrip={trip} />);
    expect(api.directions).not.toHaveBeenCalled();
    expect(screen.getByTestId("route-status").textContent).toBe("Add 2 stops to see the route");
  });

  it("toggles visited through the API", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    const existing = newStop({});
    vi.mocked(api.updateStop).mockResolvedValue({ stop: { ...existing, visited: true } });
    render(<TripEditor initialTrip={{ ...trip, stops: [existing] }} />);
    await userEvent.click(screen.getByLabelText("Visited"));
    expect(api.updateStop).toHaveBeenCalledWith("s1", { visited: true });
    await waitFor(() => expect((screen.getByLabelText("Visited") as HTMLInputElement).checked).toBe(true));
  });

  it("reverts an optimistic reorder when the API rejects", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    const stop1 = newStop({ id: "s1", order: 0, name: "Pin 1" });
    const stop2 = newStop({ id: "s2", order: 1, name: "Pin 2", lat: 37.6, lng: -119.6 });
    let rejectReorder!: (e: Error) => void;
    vi.mocked(api.reorderStops).mockImplementation(
      () => new Promise((_resolve, reject) => { rejectReorder = reject; }),
    );
    render(<TripEditor initialTrip={{ ...trip, stops: [stop1, stop2] }} />);

    await userEvent.click(screen.getByRole("button", { name: "reorder" }));

    // Optimistic: the new order is applied immediately, before the API call settles.
    await waitFor(() => expect(screen.getAllByTestId("stop-row")[0].textContent).toContain("1. Pin 2"));
    expect(api.reorderStops).toHaveBeenCalledWith("t1", ["s2", "s1"]);

    await act(async () => {
      rejectReorder(new Error("Couldn't save the new order"));
    });

    // Reverted: back to the original order, with an inline, dismissible error.
    await waitFor(() => expect(screen.getAllByTestId("stop-row")[0].textContent).toContain("1. Pin 1"));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't save the new order");
  });

  it("preserves a concurrent stop update when an in-flight reorder is later reverted", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    const stop1 = newStop({ id: "s1", order: 0, name: "Pin 1" });
    const stop2 = newStop({ id: "s2", order: 1, name: "Pin 2", lat: 37.6, lng: -119.6 });
    let rejectReorder!: (e: Error) => void;
    vi.mocked(api.reorderStops).mockImplementation(
      () => new Promise((_resolve, reject) => { rejectReorder = reject; }),
    );
    vi.mocked(api.updateStop).mockResolvedValue({ stop: { ...stop1, visited: true } });
    render(<TripEditor initialTrip={{ ...trip, stops: [stop1, stop2] }} />);

    await userEvent.click(screen.getByRole("button", { name: "reorder" }));

    // Optimistic: the new order is applied immediately, the reorder request is still in flight.
    await waitFor(() => expect(screen.getAllByTestId("stop-row")[0].textContent).toContain("1. Pin 2"));
    expect(api.reorderStops).toHaveBeenCalledWith("t1", ["s2", "s1"]);

    // While the reorder is still pending, a DIFFERENT mutation (toggling Visited
    // on Pin 1) is made and resolves successfully before the reorder settles.
    const pin1RowBefore = screen.getAllByTestId("stop-row").find((r) => r.textContent?.includes("Pin 1"))!;
    await userEvent.click(within(pin1RowBefore).getByLabelText("Visited"));
    await waitFor(() => {
      const row = screen.getAllByTestId("stop-row").find((r) => r.textContent?.includes("Pin 1"))!;
      expect((within(row).getByLabelText("Visited") as HTMLInputElement).checked).toBe(true);
    });

    // Now the still-pending reorder rejects and its revert runs.
    await act(async () => {
      rejectReorder(new Error("Couldn't save the new order"));
    });

    // Order is reverted, but the concurrent Visited toggle must survive the
    // revert instead of being clobbered by a stale closure snapshot.
    await waitFor(() => expect(screen.getAllByTestId("stop-row")[0].textContent).toContain("1. Pin 1"));
    const pin1RowAfter = screen.getAllByTestId("stop-row").find((r) => r.textContent?.includes("Pin 1"))!;
    expect((within(pin1RowAfter).getByLabelText("Visited") as HTMLInputElement).checked).toBe(true);
  });
});
