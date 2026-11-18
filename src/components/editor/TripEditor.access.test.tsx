// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage } from "../../../tests/helpers/memory-storage";
import { resetPlacePhotoCache } from "@/lib/place-photo-cache";

vi.mock("@/lib/api-client", () => ({
  api: {
    directions: vi.fn(), addStop: vi.fn(), suggestions: vi.fn(), reorderStops: vi.fn(), resolveAccess: vi.fn(),
    updateStop: vi.fn(), uploadPhoto: vi.fn(), deleteStop: vi.fn(), updateTrip: vi.fn(), reverseGeocode: vi.fn(), suggestionPopularity: vi.fn(), placePhoto: vi.fn(async () => ({ photo: null })), geocode: vi.fn(), optimizeOrder: vi.fn(), getTrip: vi.fn(), locate: vi.fn(async () => ({ area: null })),
  },
}));
vi.mock("./MapView", () => ({
  MapView: (p: import("./map-types").MapViewProps) => (
    <div>
      <button type="button" onClick={() => p.stops[0] && p.onStopMove?.(p.stops[0].id, { lat: 38, lng: -118 })}>drag first marker</button>
      <button type="button" onClick={() => p.stops[0] && p.onStopMove?.(p.stops[0].id, { lat: 39, lng: -117 })}>drag first marker again</button>
      <span data-testid="first-access">{p.stops[0]?.access ? "lot" : "none"}</span>
      <span data-testid="first-stop">{p.stops[0]?.lat},{p.stops[0]?.lng},{p.stops[0]?.name}</span>
    </div>
  ),
}));
vi.mock("./SearchBar", () => ({ SearchBar: () => null }));
vi.mock("@/lib/itinerary-download", () => ({
  createItineraryPdf: vi.fn(), loadWeatherLines: vi.fn(), saveBlob: vi.fn(), mapTokenFromEnv: vi.fn(() => null),
}));
import { api } from "@/lib/api-client";
import type { Stop, TripWithStops } from "@/lib/types";
import { TripEditor } from "./TripEditor";
import { routeSignature } from "@/lib/route-signature";

const trip: TripWithStops = { id: "t1", name: "Sierra loop", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] };
const route = { geometry: [[-119.79, 36.74], [-119.12, 37.96]] as [number, number][], legs: [{ distance: 100_000, duration: 3_600 }], distance: 100_000, duration: 3_600 };
const LOT = { lat: 36.01, lng: -119.02, name: "Trailhead lot", walkMeters: 400 };
const mkStop = (id: string, order: number, over: Partial<Stop> = {}): Stop => ({
  id, tripId: "t1", order, name: id.toUpperCase(), lat: 36 + order, lng: -119, notes: null, source: "manual", photoUrl: null, visited: false, lightPref: "any", priority: "normal", dwellMinutes: 30, shotNotes: null, shotChecklist: [], access: null, accessResolvedAt: "2026-11-17T10:00:00.000Z", ...over,
});
const withStops = (stops: Stop[]): TripWithStops => ({ ...trip, stops });

beforeEach(() => {
  window.sessionStorage.clear();
  installMemoryStorage();
  vi.clearAllMocks();
  resetPlacePhotoCache();
  vi.mocked(api.suggestions).mockResolvedValue({ suggestions: [] });
  vi.mocked(api.locate).mockResolvedValue({ area: null });
  vi.mocked(api.directions).mockResolvedValue({ route });
});

describe("TripEditor parking lot routing", () => {
  it("sends the lot's coordinates to directions for a stop that has one", async () => {
    render(<TripEditor initialTrip={withStops([mkStop("a", 0, { access: LOT }), mkStop("b", 1)])} />);
    await waitFor(() => expect(api.directions).toHaveBeenCalled());
    expect(vi.mocked(api.directions).mock.calls.at(-1)![0]).toEqual([[LOT.lng, LOT.lat], [-119, 37]]);
    expect(api.resolveAccess).not.toHaveBeenCalled();
  });

  it("resolves a stop that never finished, merges the lot, and asks for the route again", async () => {
    const a = mkStop("a", 0, { accessResolvedAt: null });
    vi.mocked(api.resolveAccess).mockResolvedValue({ stop: { ...a, name: "SERVER NAME", access: LOT, accessResolvedAt: "2026-11-17T11:00:00.000Z" } });
    render(<TripEditor initialTrip={withStops([a, mkStop("b", 1)])} />);
    await waitFor(() => expect(api.resolveAccess).toHaveBeenCalledWith("a"));
    await waitFor(() => expect(vi.mocked(api.directions).mock.calls.at(-1)![0]).toEqual([[LOT.lng, LOT.lat], [-119, 37]]));
    expect(vi.mocked(api.directions).mock.calls[0]![0]).toEqual([[-119, 36], [-119, 37]]);
    expect(api.resolveAccess).toHaveBeenCalledTimes(1);
  });

  it("looks up a moved stop again at the new spot and does not apply an answer for the old spot", async () => {
    const a = mkStop("a", 0, { access: LOT });
    vi.mocked(api.updateStop).mockResolvedValue({ stop: { ...a, lat: 38, lng: -118, access: null, accessResolvedAt: null } } as never);
    vi.mocked(api.resolveAccess).mockResolvedValue({ stop: { ...a, lat: 38, lng: -118, access: { ...LOT, lat: 38.01, lng: -118.01 }, accessResolvedAt: "2026-11-17T12:00:00.000Z" } });
    const { getByText } = render(<TripEditor initialTrip={withStops([a, mkStop("b", 1)])} />);
    await act(async () => { getByText("drag first marker").click(); });
    await waitFor(() => expect(api.resolveAccess).toHaveBeenCalledWith("a"));
    await waitFor(() => expect(vi.mocked(api.directions).mock.calls.at(-1)![0]).toEqual([[-118.01, 38.01], [-119, 37]]));
  });

  it("moving a resolved stop drops its old lot at once, before the save finishes", async () => {
    const a = mkStop("a", 0, { access: LOT, accessResolvedAt: "2026-11-17T10:00:00.000Z" });
    vi.mocked(api.updateStop).mockReturnValue(new Promise(() => {}));
    const { getByText, getByTestId } = render(<TripEditor initialTrip={withStops([a, mkStop("b", 1)])} />);
    expect(getByTestId("first-access").textContent).toBe("lot");
    await act(async () => { getByText("drag first marker").click(); });
    expect(getByTestId("first-access").textContent).toBe("none");
  });

  it("a stop dragged before its first lookup finishes is looked up only after the move is saved, and ends with its lot", async () => {
    const a = mkStop("a", 0, { accessResolvedAt: null });
    let saved!: (v: unknown) => void;
    vi.mocked(api.updateStop).mockReturnValue(new Promise((r) => { saved = r; }) as never);
    vi.mocked(api.resolveAccess).mockImplementation(async (id: string) => ({ stop: { ...a, id, lat: 38, lng: -118, access: { ...LOT, lat: 38.01, lng: -118.01 }, accessResolvedAt: "2026-11-17T12:00:00.000Z" } }) as never);
    const { getByText, getByTestId } = render(<TripEditor initialTrip={withStops([a, mkStop("b", 1)])} />);
    await act(async () => { getByText("drag first marker").click(); });
    await new Promise((r) => setTimeout(r, 50));
    // Every lookup so far was for the old spot, none while the PATCH is in flight.
    const before = vi.mocked(api.resolveAccess).mock.calls.length;
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(vi.mocked(api.resolveAccess).mock.calls.length).toBe(before);
    await act(async () => { saved({ stop: { ...a, lat: 38, lng: -118, access: null, accessResolvedAt: null } }); });
    await waitFor(() => expect(getByTestId("first-access").textContent).toBe("lot"));
  });

  describe("while lots are still being looked up", () => {
    const unresolved = (id: string, order: number) => mkStop(id, order, { accessResolvedAt: null });

    it("Optimize waits for the lookups, then plans from the lot coordinates", async () => {
      const a = unresolved("a", 0);
      let finish: (v: { stop: Stop }) => void = () => {};
      vi.mocked(api.resolveAccess).mockImplementation(() => new Promise((r) => { finish = r; }));
      vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 1], departAt: null, misses: [] });
      vi.mocked(api.updateTrip).mockImplementation(async (_id, patch) => ({ trip: { ...trip, ...patch } as never }));
      render(<TripEditor initialTrip={withStops([a, mkStop("b", 1), mkStop("c", 2)])} />);
      await userEvent.click(screen.getByRole("tab", { name: "My trip" }));
      await waitFor(() => expect(api.resolveAccess).toHaveBeenCalledWith("a"));
      await userEvent.click(screen.getByRole("button", { name: "Optimize route" }));
      await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
      expect(api.optimizeOrder).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Optimizing…" })).toBeTruthy();
      await act(async () => { finish({ stop: { ...a, access: LOT, accessResolvedAt: "2026-11-17T11:00:00.000Z" } }); });
      await waitFor(() => expect(api.optimizeOrder).toHaveBeenCalledTimes(1));
      expect(vi.mocked(api.optimizeOrder).mock.calls[0]![0]).toEqual([[LOT.lng, LOT.lat], [-119, 37], [-119, 38]]);
    });

    it("Optimize does not wait forever: after 8 s it runs with what it has", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        vi.mocked(api.resolveAccess).mockImplementation(() => new Promise(() => {}));
        vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 1], departAt: null, misses: [] });
        vi.mocked(api.updateTrip).mockImplementation(async (_id, patch) => ({ trip: { ...trip, ...patch } as never }));
        render(<TripEditor initialTrip={withStops([unresolved("a", 0), mkStop("b", 1), mkStop("c", 2)])} />);
        fireEvent.click(screen.getByRole("tab", { name: "My trip" }));
        await act(async () => { await vi.advanceTimersByTimeAsync(10); });
        fireEvent.click(screen.getByRole("button", { name: "Optimize route" }));
        await act(async () => { await vi.advanceTimersByTimeAsync(7500); });
        expect(api.optimizeOrder).not.toHaveBeenCalled();
        await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
        expect(api.optimizeOrder).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("lots arriving together produce one directions request after the first draw, not one each", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const list = ["a", "b", "c"].map((id, i) => unresolved(id, i));
        vi.mocked(api.resolveAccess).mockImplementation(async (id: string) => {
          const s = list.find((x) => x.id === id)!;
          return { stop: { ...s, access: { ...LOT, lat: s.lat + 0.01 }, accessResolvedAt: "2026-11-17T11:00:00.000Z" } };
        });
        render(<TripEditor initialTrip={withStops(list)} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(50); }); // the lots land and are applied
        expect(api.resolveAccess).toHaveBeenCalledTimes(3);
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        // The first draw goes out at once (stops only); the three lots then cost one request, not three.
        expect(api.directions).toHaveBeenCalledTimes(2);
        expect(vi.mocked(api.directions).mock.calls[0]![0]).toEqual(list.map((s) => [s.lng, s.lat]));
        expect(vi.mocked(api.directions).mock.calls[1]![0]).toEqual(list.map((s) => [LOT.lng, s.lat + 0.01]));
      } finally {
        vi.useRealTimers();
      }
    });

    it("25 stops looked up 3 at a time (a lot about every second) make a handful of route requests, and the last one has every lot", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      try {
        const list = Array.from({ length: 25 }, (_, i) => unresolved(`s${i}`, i));
        vi.mocked(api.resolveAccess).mockImplementation(async (id: string) => {
          await new Promise((r) => setTimeout(r, 2000 + (Number(id.slice(1)) % 3) * 1000));
          const s = list.find((x) => x.id === id)!;
          return { stop: { ...s, access: { ...LOT, lat: s.lat + 0.01 }, accessResolvedAt: "2026-11-17T11:00:00.000Z" } };
        });
        render(<TripEditor initialTrip={withStops(list)} />);
        // One act per step: React applies each lot as it lands (measured before the change: 18 requests, now 10 or fewer).
        for (let k = 0; k < 1200; k++) await act(async () => { await vi.advanceTimersByTimeAsync(50); });
        expect(api.resolveAccess).toHaveBeenCalledTimes(25);
        expect(vi.mocked(api.directions).mock.calls.length).toBeLessThanOrEqual(11);
        expect(vi.mocked(api.directions).mock.calls.at(-1)![0]).toEqual(list.map((s) => [LOT.lng, s.lat + 0.01]));
      } finally {
        vi.useRealTimers();
      }
    });

    it("draws the first route at once when nothing is pending", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(<TripEditor initialTrip={withStops([mkStop("a", 0), mkStop("b", 1)])} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(5); });
        expect(api.directions).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("two quick moves of one stop", () => {
  const A = () => mkStop("a", 0, { access: LOT });
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
  const answer = (lat: number, lng: number) => ({ stop: { ...A(), lat, lng, access: null, accessResolvedAt: null } });
  const twoMoves = async () => {
    const d1 = deferred();
    const d2 = deferred();
    vi.mocked(api.updateStop).mockReturnValueOnce(d1.promise as never).mockReturnValueOnce(d2.promise as never);
    vi.mocked(api.resolveAccess).mockImplementation(async (id: string) => ({ stop: { ...A(), id, lat: 39, lng: -117, access: { ...LOT, lat: 39.01, lng: -117.01 }, accessResolvedAt: "2026-11-17T12:00:00.000Z" } }) as never);
    const view = render(<TripEditor initialTrip={withStops([A(), mkStop("b", 1)])} />);
    await act(async () => { view.getByText("drag first marker").click(); });
    await act(async () => { view.getByText("drag first marker again").click(); });
    return { d1, d2, ...view };
  };
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });

  it("the first response does not pull the marker back or start a lookup while the second is in flight, in order", async () => {
    const { d1, d2, getByTestId } = await twoMoves();
    await act(async () => { d1.resolve(answer(38, -118)); });
    await settle();
    expect(getByTestId("first-stop").textContent).toBe("39,-117,A");
    expect(api.resolveAccess).not.toHaveBeenCalled();
    await act(async () => { d2.resolve(answer(39, -117)); });
    await waitFor(() => expect(getByTestId("first-access").textContent).toBe("lot"));
    expect(getByTestId("first-stop").textContent).toBe("39,-117,A");
    expect(vi.mocked(api.resolveAccess).mock.calls.length).toBe(1);
  });

  it("answers arriving out of order leave the latest position and look up only once, after both are in", async () => {
    const { d1, d2, getByTestId } = await twoMoves();
    await act(async () => { d2.resolve(answer(39, -117)); });
    await settle();
    expect(getByTestId("first-stop").textContent).toBe("39,-117,A");
    await act(async () => { d1.resolve(answer(38, -118)); });
    await waitFor(() => expect(getByTestId("first-access").textContent).toBe("lot"));
    expect(getByTestId("first-stop").textContent).toBe("39,-117,A");
    expect(vi.mocked(api.resolveAccess).mock.calls.length).toBe(1);
  });

  it("a failed older save does not roll back the newer position and shows no error", async () => {
    const { d1, d2, getByTestId, queryByRole } = await twoMoves();
    await act(async () => { d1.reject(Object.assign(new Error("Server hiccup"), { status: 500 })); });
    await settle();
    expect(getByTestId("first-stop").textContent).toBe("39,-117,A");
    expect(queryByRole("alert")).toBeNull();
    await act(async () => { d2.resolve(answer(39, -117)); });
    await waitFor(() => expect(getByTestId("first-access").textContent).toBe("lot"));
  });

  it("a failed latest save rolls back to the last saved place and says so", async () => {
    const { d1, d2, getByTestId, findByText } = await twoMoves();
    await act(async () => { d1.resolve(answer(38, -118)); });
    await act(async () => { d2.reject(Object.assign(new Error("Server hiccup"), { status: 500 })); });
    expect(await findByText(/Server hiccup/)).toBeTruthy();
    expect(getByTestId("first-stop").textContent).toBe("38,-118,A");
  });

  it("Optimize waits for a moved stop's save and its new lot before planning", async () => {
    const d = deferred();
    vi.mocked(api.updateStop).mockReturnValueOnce(d.promise as never);
    vi.mocked(api.resolveAccess).mockImplementation(async (id: string) => ({ stop: { ...A(), id, lat: 38, lng: -118, access: { ...LOT, lat: 38.01, lng: -118.01 }, accessResolvedAt: "2026-11-17T12:00:00.000Z" } }) as never);
    vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 1, 2], departAt: null, misses: [] });
    vi.mocked(api.updateTrip).mockImplementation(async (_id, patch) => ({ trip: { ...trip, ...patch } as never }));
    const { getByText } = render(<TripEditor initialTrip={withStops([A(), mkStop("b", 1), mkStop("c", 2)])} />);
    await act(async () => { getByText("drag first marker").click(); });
    await userEvent.click(screen.getByRole("tab", { name: "My trip" }));
    await userEvent.click(screen.getByRole("button", { name: "Optimize route" }));
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    expect(api.optimizeOrder).not.toHaveBeenCalled();
    await act(async () => { d.resolve(answer(38, -118)); });
    await waitFor(() => expect(api.optimizeOrder).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.optimizeOrder).mock.calls[0]![0][0]).toEqual([-118.01, 38.01]);
  });

  it("a stop deleted while its move was saving: the late 404 is swallowed, a real error for a stop that remains is not", async () => {
    const d = deferred();
    vi.mocked(api.updateStop).mockReturnValueOnce(d.promise as never);
    vi.mocked(api.deleteStop).mockResolvedValue({} as never);
    const { getByText, queryByText } = render(<TripEditor initialTrip={withStops([A(), mkStop("b", 1)])} />);
    await act(async () => { getByText("drag first marker").click(); });
    await userEvent.click(screen.getByRole("tab", { name: "Stops" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete A" }));
    await userEvent.click(within(screen.getByRole("alertdialog", { name: "Delete stop?" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.deleteStop).toHaveBeenCalledWith("a"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Delete A" })).toBeNull());
    await act(async () => { d.reject(Object.assign(new Error("Stop not found"), { status: 404 })); });
    await settle();
    expect(queryByText(/Stop not found/)).toBeNull();
  });

  it("a 404 for a stop that is still in the list is still shown", async () => {
    const d = deferred();
    vi.mocked(api.updateStop).mockReturnValueOnce(d.promise as never);
    const { getByText, findByText } = render(<TripEditor initialTrip={withStops([A(), mkStop("b", 1)])} />);
    await act(async () => { getByText("drag first marker").click(); });
    await act(async () => { d.reject(Object.assign(new Error("Stop not found"), { status: 404 })); });
    expect(await findByText(/Stop not found/)).toBeTruthy();
  });
});

describe("walk time from the parking lot", () => {
  it("Optimize sends each lot stop's one-way walk minutes (400 m is 6 min, rounded up to 10) and none for a stop without a lot", async () => {
    vi.mocked(api.optimizeOrder).mockResolvedValue({ order: [0, 1, 2], departAt: null, misses: [] });
    vi.mocked(api.updateTrip).mockImplementation(async (_id, patch) => ({ trip: { ...trip, ...patch } as never }));
    render(<TripEditor initialTrip={withStops([mkStop("a", 0, { access: LOT }), mkStop("b", 1), mkStop("c", 2)])} />);
    await userEvent.click(screen.getByRole("tab", { name: "My trip" }));
    await userEvent.click(screen.getByRole("button", { name: "Optimize route" }));
    await waitFor(() => expect(api.optimizeOrder).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(api.optimizeOrder).mock.calls[0]![1]!.stops;
    expect(sent[0]).toMatchObject({ dwellMinutes: 30, walkMinutes: 10 });
    expect(sent[1]).not.toHaveProperty("walkMinutes");
    expect(sent[2]).not.toHaveProperty("walkMinutes");
  });

  it("a lot arriving for an optimized trip recomputes silently: no 'Your stops changed' notice, no new optimize", async () => {
    const a = mkStop("a", 0, { accessResolvedAt: null });
    const stops = [a, mkStop("b", 1)];
    vi.mocked(api.resolveAccess).mockResolvedValue({ stop: { ...a, access: LOT, accessResolvedAt: "2026-11-17T11:00:00.000Z" } });
    render(<TripEditor initialTrip={{ ...withStops(stops), routeOptimizedFor: routeSignature("2026-07-01", stops) }} />);
    await userEvent.click(screen.getByRole("tab", { name: "My trip" }));
    await waitFor(() => expect(api.resolveAccess).toHaveBeenCalledWith("a"));
    await waitFor(() => expect(vi.mocked(api.directions).mock.calls.at(-1)![0]).toEqual([[LOT.lng, LOT.lat], [-119, 37]]));
    await waitFor(() => expect(screen.getByTestId("park-line").textContent).toMatch(/\(~10 min\)/));
    expect(screen.queryByText(/Your stops changed/)).toBeNull();
    expect(api.optimizeOrder).not.toHaveBeenCalled();
  });
});
