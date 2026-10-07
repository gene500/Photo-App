// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
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
import { api } from "@/lib/api-client";
import type { Stop, TripWithStops } from "@/lib/types";
import { TripEditor } from "./TripEditor";

const trip: TripWithStops = {
  id: "t1", name: "Sierra loop", plannedDate: "2026-07-01",
  start: { name: "Fresno", lat: 36.74, lng: -119.79 }, end: { name: "Lee Vining", lat: 37.96, lng: -119.12 },
  stops: [],
};
const route = { geometry: [[-119.79, 36.74], [-119.12, 37.96]] as [number, number][], legs: [{ distance: 100_000, duration: 3_600 }], distance: 100_000, duration: 3_600 };
const newStop = (over: Partial<Stop>): Stop => ({
  id: "s1", tripId: "t1", order: 0, name: "Pin 1", lat: 37.5, lng: -119.5, notes: null, source: "manual", photoUrl: null, visited: false, ...over,
});

describe("TripEditor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the route for start -> stops -> end and shows its summary", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    render(<TripEditor initialTrip={trip} />);
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toBe("100 km · 1 h 0 min"));
    expect(api.directions).toHaveBeenCalledWith([[-119.79, 36.74], [-119.12, 37.96]]);
  });

  it("shows a dismissible route error while the rest of the editor keeps working", async () => {
    vi.mocked(api.directions).mockRejectedValue(new Error("No driving route found between these points"));
    vi.mocked(api.addStop).mockResolvedValue({ stop: newStop({}) });
    render(<TripEditor initialTrip={trip} />);
    expect((await screen.findByRole("alert")).textContent).toContain("No driving route found");
    expect(screen.getByTestId("route-status").textContent).toBe("Route unavailable");
    await userEvent.click(screen.getByRole("button", { name: "drop pin" }));
    expect(await screen.findAllByTestId("stop-row")).toHaveLength(1);
  });

  it("adds a manual stop when the map is clicked and refetches the route", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.addStop).mockResolvedValue({ stop: newStop({}) });
    render(<TripEditor initialTrip={trip} />);
    await userEvent.click(screen.getByRole("button", { name: "drop pin" }));
    expect(api.addStop).toHaveBeenCalledWith("t1", { name: "Pin 1", lat: 37.5, lng: -119.5, source: "manual" });
    await waitFor(() => expect(api.directions).toHaveBeenLastCalledWith([[-119.79, 36.74], [-119.5, 37.5], [-119.12, 37.96]]));
  });

  it("finds suggestions and accepts one as a suggested stop", async () => {
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [{ osmId: "node/1", name: "Tunnel View", lat: 37.7, lng: -119.7, kind: "viewpoint" }] });
    vi.mocked(api.addStop).mockResolvedValue({ stop: newStop({ name: "Tunnel View", source: "suggested", lat: 37.7, lng: -119.7 }) });
    render(<TripEditor initialTrip={trip} />);
    await waitFor(() => expect(screen.getByTestId("route-status").textContent).toContain("km"));
    await userEvent.click(screen.getByRole("button", { name: "Find photo spots" }));
    await userEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(api.addStop).toHaveBeenCalledWith("t1", { name: "Tunnel View", lat: 37.7, lng: -119.7, source: "suggested" });
    await waitFor(() => expect(screen.queryAllByTestId("suggestion-card")).toHaveLength(0));
    expect(screen.getAllByTestId("stop-row")[0].textContent).toContain("Tunnel View");
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
});
