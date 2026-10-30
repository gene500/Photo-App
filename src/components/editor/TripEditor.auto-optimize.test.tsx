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
    updateStop: vi.fn(), uploadPhoto: vi.fn(), deleteStop: vi.fn(), updateTrip: vi.fn(), reverseGeocode: vi.fn(), suggestionPopularity: vi.fn(), placePhoto: vi.fn(async () => ({ photo: null })), geocode: vi.fn(), optimizeOrder: vi.fn(), locate: vi.fn(async () => ({ area: null })),
  },
}));
vi.mock("./MapView", () => ({ MapView: () => <div /> }));
vi.mock("./SearchBar", () => ({ SearchBar: () => <div /> }));
vi.mock("@/lib/itinerary-download", () => ({
  createItineraryPdf: vi.fn(), loadWeatherLines: vi.fn(), saveBlob: vi.fn(), mapTokenFromEnv: vi.fn(() => null),
}));
import { api } from "@/lib/api-client";
import type { Stop, TripWithStops } from "@/lib/types";
import { TripEditor } from "./TripEditor";

const trip: TripWithStops = { id: "t1", name: "Sierra loop", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] };
const route = { geometry: [[-119.79, 36.74], [-119.12, 37.96]] as [number, number][], legs: [{ distance: 100_000, duration: 3_600 }], distance: 100_000, duration: 3_600 };
const mk = (id: string, order: number, lat: number): Stop => ({
  id, tripId: "t1", order, name: id.toUpperCase(), lat, lng: -119, notes: null, source: "manual", photoUrl: null, visited: false, lightPref: "any", priority: "normal", dwellMinutes: 30, shotNotes: null, shotChecklist: [], ...{},
});
const four = [mk("a", 0, 36), mk("b", 1, 38), mk("c", 2, 37), mk("d", 3, 39)];
const WAIT = { timeout: 4000 };
/** Moves the (fake) clock on without really waiting; the clock also ticks with real time so waitFor and userEvent keep working. */
const settle = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

/** Server behaviour for a visited change, including the cascade (earlier checked, later unchecked). */
function serverUpdate(list: Stop[]) {
  const rows = list.map((x) => ({ ...x }));
  return async (id: string, patch: Partial<Stop>) => {
    const at = rows.findIndex((x) => x.id === id);
    Object.assign(rows[at], patch);
    const changed: Stop[] = [];
    if (patch.visited !== undefined) {
      rows.forEach((x, i) => {
        if (i !== at && (patch.visited ? i < at : i > at) && x.visited !== patch.visited) { x.visited = patch.visited!; changed.push({ ...x }); }
      });
    }
    return { stop: { ...rows[at] }, ...(changed.length ? { stops: changed } : {}) };
  };
}
const tick = (name: string) => userEvent.click(screen.getByLabelText(`Visited: ${name}`));
const openMyTrip = () => userEvent.click(screen.getByRole("tab", { name: "My trip" }));
const rowNames = () => screen.getAllByTestId("trip-row").map((r) => within(r).getByRole("button", { name: /^\d+\./ }).textContent ?? "");

describe("TripEditor: re-optimize when a stop is ticked", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.sessionStorage.clear();
    installMemoryStorage();
    vi.clearAllMocks();
    resetPlacePhotoCache();
    vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [] });
    vi.mocked(api.locate).mockResolvedValue({ area: null });
    vi.mocked(api.directions).mockResolvedValue({ route });
    vi.mocked(api.updateTrip).mockImplementation(async (_id, patch) => ({ trip: { ...trip, ...patch } as never }));
    vi.mocked(api.updateStop).mockImplementation(serverUpdate(four));
    vi.mocked(api.reorderStops).mockImplementation(async (_t, ids) => ({ stops: ids.map((id, order) => ({ ...four.find((s) => s.id === id)!, order })) }));
  });
  afterEach(() => { vi.useRealTimers(); Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true }); });

  it("runs Optimize once, quietly, about 600 ms after the tick, planning from the visited stop", async () => {
    vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 3, 2, 1], departAt: null, misses: [] });
    render(<TripEditor initialTrip={{ ...trip, stops: four }} />);
    await openMyTrip();
    await tick("A");
    await waitFor(() => expect((screen.getByLabelText("Visited: A") as HTMLInputElement).checked).toBe(true));
    expect(api.optimizeOrder).not.toHaveBeenCalled(); // debounced
    await waitFor(() => expect(api.optimizeOrder).toHaveBeenCalledTimes(1), WAIT);
    const sent = vi.mocked(api.optimizeOrder).mock.calls[0]!;
    expect(sent[0]).toHaveLength(4); // the visited stop is the fixed start, then the three unvisited
    expect((sent[1] as { fixDeparture?: boolean }).fixDeparture).toBe(true);
    await waitFor(() => expect(api.reorderStops).toHaveBeenCalledWith("t1", ["a", "d", "c", "b"]));
    await waitFor(() => expect(rowNames().map((n) => n.slice(-1))).toEqual(["A", "D", "C", "B"]));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy(); // Undo reverts the auto run
  });

  it("never shows the busy state or the Optimizing label during the background run", async () => {
    let release!: (v: { order: number[] }) => void;
    vi.mocked(api.optimizeOrder).mockReturnValue(new Promise((res) => (release = res)));
    render(<TripEditor initialTrip={{ ...trip, stops: four }} />);
    await openMyTrip();
    await tick("A");
    await waitFor(() => expect(api.optimizeOrder).toHaveBeenCalledTimes(1), WAIT);
    expect(screen.queryByRole("button", { name: "Optimizing…" })).toBeNull();
    expect(screen.getByRole("button", { name: "Optimize route" }).getAttribute("aria-disabled")).toBeNull();
    await act(async () => release({ order: [0, 1, 2, 3] }));
  });

  it("turns several quick ticks into one run", async () => {
    vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 1, 2, 3] });
    const five = [...four, mk("e", 4, 40)];
    vi.mocked(api.updateStop).mockImplementation(serverUpdate(five));
    render(<TripEditor initialTrip={{ ...trip, stops: five }} />);
    await openMyTrip();
    await tick("A");
    await tick("B");
    await waitFor(() => expect((screen.getByLabelText("Visited: B") as HTMLInputElement).checked).toBe(true));
    await settle(1500);
    expect(api.optimizeOrder).toHaveBeenCalledTimes(1);
  });

  it("skips when fewer than 2 stops are left unvisited", async () => {
    vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 1, 2, 3] });
    render(<TripEditor initialTrip={{ ...trip, stops: four }} />);
    await openMyTrip();
    await tick("C"); // A, B, C visited; only D left
    await waitFor(() => expect((screen.getByLabelText("Visited: C") as HTMLInputElement).checked).toBe(true));
    await settle(1000);
    expect(api.optimizeOrder).not.toHaveBeenCalled();
  });

  it("does nothing when the per-device setting is off", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ autoReoptimize: false }));
    vi.resetModules();
    const { SettingsProvider } = await import("@/components/settings/SettingsProvider");
    const { TripEditor: Editor } = await import("./TripEditor");
    const { api: fresh } = await import("@/lib/api-client");
    vi.mocked(fresh.suggestions).mockResolvedValue({ suggestions: [] });
    vi.mocked(fresh.directions).mockResolvedValue({ route });
    vi.mocked(fresh.updateStop).mockImplementation(serverUpdate(four));
    render(<SettingsProvider><Editor initialTrip={{ ...trip, stops: four }} /></SettingsProvider>);
    await openMyTrip();
    await tick("A");
    await waitFor(() => expect((screen.getByLabelText("Visited: A") as HTMLInputElement).checked).toBe(true));
    await settle(1000);
    expect(fresh.optimizeOrder).not.toHaveBeenCalled();
  });

  it("skips while the browser is offline", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    render(<TripEditor initialTrip={{ ...trip, stops: four }} />);
    await openMyTrip();
    await tick("A");
    await waitFor(() => expect((screen.getByLabelText("Visited: A") as HTMLInputElement).checked).toBe(true));
    await settle(1000);
    expect(api.optimizeOrder).not.toHaveBeenCalled();
  });

  it("stays silent and leaves the order alone when the background run fails", async () => {
    vi.mocked(api.optimizeOrder).mockRejectedValue(new Error("Couldn't calculate drive times. Please try again."));
    render(<TripEditor initialTrip={{ ...trip, stops: four }} />);
    await openMyTrip();
    await tick("A");
    await waitFor(() => expect(api.optimizeOrder).toHaveBeenCalledTimes(1), WAIT);
    await settle(50);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.reorderStops).not.toHaveBeenCalled();
    expect(rowNames().map((n) => n.slice(-1))).toEqual(["A", "B", "C", "D"]);
  });

  it("stays silent when saving the new order fails", async () => {
    vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 3, 2, 1] });
    vi.mocked(api.reorderStops).mockRejectedValue(new Error("nope"));
    render(<TripEditor initialTrip={{ ...trip, stops: four }} />);
    await openMyTrip();
    await tick("A");
    await waitFor(() => expect(api.reorderStops).toHaveBeenCalled(), WAIT);
    await settle(50);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(rowNames().map((n) => n.slice(-1))).toEqual(["A", "B", "C", "D"]);
  });

  it("does not start a second run while one is in flight, then runs once more", async () => {
    const five = [...four, mk("e", 4, 40)];
    vi.mocked(api.updateStop).mockImplementation(serverUpdate(five));
    vi.mocked(api.reorderStops).mockImplementation(async (_t, ids) => ({ stops: ids.map((id, order) => ({ ...five.find((s) => s.id === id)!, order })) }));
    let release!: (v: { order: number[] }) => void;
    vi.mocked(api.optimizeOrder).mockReturnValueOnce(new Promise((res) => (release = res)));
    vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 1, 2, 3] });
    render(<TripEditor initialTrip={{ ...trip, stops: five }} />);
    await openMyTrip();
    await tick("A");
    await waitFor(() => expect(api.optimizeOrder).toHaveBeenCalledTimes(1), WAIT);
    await tick("B");
    await waitFor(() => expect((screen.getByLabelText("Visited: B") as HTMLInputElement).checked).toBe(true));
    await settle(1000);
    expect(api.optimizeOrder).toHaveBeenCalledTimes(1);
    await act(async () => release({ order: [0, 1, 2, 3, 4] }));
    await waitFor(() => expect(api.optimizeOrder).toHaveBeenCalledTimes(2), WAIT);
    await settle(1000);
    expect(api.optimizeOrder).toHaveBeenCalledTimes(2);
  });

  it("re-optimizes when a stop is unticked too, and keeps the stops still visited first", async () => {
    const visitedAB = four.map((s) => (s.id === "a" || s.id === "b" ? { ...s, visited: true } : s));
    vi.mocked(api.updateStop).mockImplementation(serverUpdate(visitedAB));
    vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 1, 2, 3] });
    render(<TripEditor initialTrip={{ ...trip, stops: visitedAB }} />);
    await openMyTrip();
    await tick("B"); // unticks B; A stays visited, B C D are free
    await waitFor(() => expect(api.optimizeOrder).toHaveBeenCalledTimes(1), WAIT);
    expect(vi.mocked(api.optimizeOrder).mock.calls[0]![0]).toHaveLength(4);
    expect((screen.getByLabelText("Visited: A") as HTMLInputElement).checked).toBe(true);
  });

  it("does not run without a tick", async () => {
    vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 1, 2, 3] });
    render(<TripEditor initialTrip={{ ...trip, stops: four }} />);
    await openMyTrip();
    await settle(1000);
    expect(api.optimizeOrder).not.toHaveBeenCalled();
  });

  it("a manual Optimize waits for a background run in flight instead of racing it", async () => {
    let release!: (v: { order: number[] }) => void;
    vi.mocked(api.optimizeOrder).mockReturnValueOnce(new Promise((res) => (release = res)));
    vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 1, 2, 3] });
    render(<TripEditor initialTrip={{ ...trip, stops: four }} />);
    await openMyTrip();
    await tick("A");
    await settle(700);
    await waitFor(() => expect(api.optimizeOrder).toHaveBeenCalledTimes(1), WAIT);
    await userEvent.click(screen.getByRole("button", { name: "Optimize route" }));
    await settle(500);
    expect(api.optimizeOrder).toHaveBeenCalledTimes(1); // still waiting for the quiet run
    await act(async () => release({ order: [0, 3, 2, 1] }));
    await waitFor(() => expect(api.optimizeOrder).toHaveBeenCalledTimes(2), WAIT);
    await settle(50);
    expect(screen.queryByText(/Your stops changed while optimizing/)).toBeNull();
  });

  it("holds a tick's background run back while a manual Optimize is busy, then runs it", async () => {
    const five = [...four, mk("e", 4, 40)];
    vi.mocked(api.updateStop).mockImplementation(serverUpdate(five));
    let release!: (v: { order: number[] }) => void;
    vi.mocked(api.optimizeOrder).mockReturnValueOnce(new Promise((res) => (release = res)));
    vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 1, 2, 3, 4] });
    render(<TripEditor initialTrip={{ ...trip, stops: five }} />);
    await openMyTrip();
    await userEvent.click(screen.getByRole("button", { name: "Optimize route" }));
    await waitFor(() => expect(api.optimizeOrder).toHaveBeenCalledTimes(1), WAIT);
    await tick("A");
    await waitFor(() => expect((screen.getByLabelText("Visited: A") as HTMLInputElement).checked).toBe(true));
    await settle(1500);
    expect(api.optimizeOrder).toHaveBeenCalledTimes(1);
    await act(async () => release({ order: [0, 1, 2, 3, 4] }));
    await settle(1500);
    await waitFor(() => expect(api.optimizeOrder).toHaveBeenCalledTimes(2), WAIT);
  });

  it("a background run after unticking everything reorders only: it does not move or save the start time", async () => {
    const visitedA = four.map((s) => (s.id === "a" ? { ...s, visited: true } : s));
    vi.mocked(api.updateStop).mockImplementation(serverUpdate(visitedA));
    vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 3, 2, 1], departAt: "2026-07-01T20:00:00.000Z", misses: [] });
    render(<TripEditor initialTrip={{ ...trip, stops: visitedA }} />);
    await openMyTrip();
    await tick("A"); // nothing visited any more
    await settle(700);
    await waitFor(() => expect(api.optimizeOrder).toHaveBeenCalledTimes(1), WAIT);
    expect((vi.mocked(api.optimizeOrder).mock.calls[0]![1] as { fixDeparture?: boolean }).fixDeparture).toBe(true);
    await waitFor(() => expect(api.reorderStops).toHaveBeenCalled(), WAIT);
    await settle(50);
    expect(vi.mocked(api.updateTrip).mock.calls.some(([, patch]) => "departAt" in (patch as object))).toBe(false);
  });
});
