// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Stop } from "@/lib/types";

vi.mock("@/lib/api-client", () => ({ api: { resolveAccess: vi.fn() } }));
import { api } from "@/lib/api-client";
import { useAccessResolver } from "./use-access-resolver";

const resolveAccess = vi.mocked(api.resolveAccess);

function stop(id: string, resolved: string | null = null): Stop {
  return { id, tripId: "t", order: 0, name: id, lat: 1, lng: 2, accessResolvedAt: resolved, access: null } as unknown as Stop;
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

type Deferred = { id: string; resolve: (s: Stop) => void; reject: (e: unknown) => void };
let pending: Deferred[] = [];
let inFlight = 0;
let maxSeen = 0;
let calls: string[] = [];

beforeEach(() => {
  pending = []; inFlight = 0; maxSeen = 0; calls = [];
  resolveAccess.mockReset();
  resolveAccess.mockImplementation((id: string) => {
    calls.push(id);
    inFlight++;
    maxSeen = Math.max(maxSeen, inFlight);
    return new Promise((resolve, reject) => {
      pending.push({
        id,
        resolve: (s) => { inFlight--; resolve({ stop: s }); },
        reject: (e) => { inFlight--; reject(e); },
      });
    });
  });
});

describe("useAccessResolver", () => {
  it("resolves 25 stops once each, never more than 3 at a time", async () => {
    const stops = Array.from({ length: 25 }, (_, i) => stop(`s${i}`));
    const onStop = vi.fn();
    renderHook(() => useAccessResolver(stops, onStop));
    await flush();
    let guard = 0;
    while (pending.length && guard++ < 100) {
      const d = pending.shift()!;
      expect(inFlight).toBeLessThanOrEqual(3);
      await act(async () => { d.resolve(stop(d.id, "now")); });
      await flush();
    }
    expect(maxSeen).toBe(3);
    expect([...calls].sort()).toEqual(stops.map((s) => s.id).sort());
    expect(onStop).toHaveBeenCalledTimes(25);
  });

  it("does not look up a held stop (move in flight) and does not mark it tried, so it is looked up once released", async () => {
    let held = true;
    const list = [stop("a")];
    const { rerender } = renderHook(({ s }) => useAccessResolver(s, vi.fn(), { isHeld: () => held }), { initialProps: { s: list } });
    await flush();
    expect(calls).toEqual([]);
    held = false;
    rerender({ s: [{ ...list[0] }] });
    await flush();
    expect(calls).toEqual(["a"]);
  });

  it("skips stops that are already resolved", async () => {
    renderHook(() => useAccessResolver([stop("a", "2026-01-01T00:00:00Z"), stop("b")], vi.fn()));
    await flush();
    expect(calls).toEqual(["b"]);
  });

  it("picks up a newly added stop", async () => {
    const { rerender } = renderHook(({ s }) => useAccessResolver(s, vi.fn()), { initialProps: { s: [stop("a", "x")] } });
    await flush();
    expect(calls).toEqual([]);
    rerender({ s: [stop("a", "x"), stop("new")] });
    await flush();
    expect(calls).toEqual(["new"]);
  });

  it("looks a moved stop up again at its new position", async () => {
    const moved = { ...stop("a"), lat: 5 };
    const { rerender } = renderHook(({ s }) => useAccessResolver(s, vi.fn()), { initialProps: { s: [stop("a")] } });
    await flush();
    rerender({ s: [moved] });
    await flush();
    expect(calls).toEqual(["a", "a"]);
  });

  it("ignores the result for a stop removed while pending", async () => {
    const onStop = vi.fn();
    const { rerender } = renderHook(({ s }) => useAccessResolver(s, onStop), { initialProps: { s: [stop("a"), stop("b")] } });
    await flush();
    rerender({ s: [stop("b")] });
    await act(async () => { pending.find((d) => d.id === "a")!.resolve(stop("a", "now")); });
    await act(async () => { pending.find((d) => d.id === "b")!.resolve(stop("b", "now")); });
    expect(onStop.mock.calls.map((c) => (c[0] as Stop).id)).toEqual(["b"]);
  });

  it("does not retry a failed resolve in the same mount and does not throw", async () => {
    const onStop = vi.fn();
    const { rerender } = renderHook(({ s }) => useAccessResolver(s, onStop), { initialProps: { s: [stop("a")] } });
    await flush();
    await act(async () => { pending[0]!.reject(new Error("down")); });
    await flush();
    rerender({ s: [stop("a")] });
    await flush();
    expect(calls).toEqual(["a"]);
    expect(onStop).not.toHaveBeenCalled();
  });

  it("looks a stop up again when it returns to an earlier position (A -> B -> A)", async () => {
    const onStop = vi.fn();
    const at = (lat: number) => ({ ...stop("a"), lat });
    const { rerender } = renderHook(({ s }) => useAccessResolver(s, onStop), { initialProps: { s: [at(1)] } });
    await flush();
    await act(async () => { pending.shift()!.resolve(stop("a", "now")); });
    rerender({ s: [at(5)] });
    await flush();
    await act(async () => { pending.shift()!.resolve(stop("a", "now")); });
    rerender({ s: [at(1)] });
    await flush();
    expect(calls).toEqual(["a", "a", "a"]);
  });

  it("sends nothing while offline and pumps when the browser comes back online", async () => {
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      renderHook(() => useAccessResolver([stop("a")], vi.fn()));
      await flush();
      expect(resolveAccess).not.toHaveBeenCalled();
      spy.mockReturnValue(true);
      await act(async () => { window.dispatchEvent(new Event("online")); });
      await flush();
      expect(calls).toEqual(["a"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not throw when the call throws synchronously", async () => {
    resolveAccess.mockImplementation(() => { throw new Error("sync"); });
    renderHook(() => useAccessResolver([stop("a")], vi.fn()));
    await flush();
    expect(resolveAccess).toHaveBeenCalledTimes(1);
  });

  it("retries a stop whose resolve failed when the browser comes back online (and not in a loop while online)", async () => {
    renderHook(() => useAccessResolver([stop("a")], vi.fn()));
    await flush();
    await act(async () => { pending.shift()!.reject(new Error("network dropped")); });
    await flush();
    expect(calls).toEqual(["a"]);
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await flush();
    expect(calls).toEqual(["a", "a"]);
    // Failing again while online: nothing more is sent until the next online event.
    await act(async () => { pending.shift()!.reject(new Error("still down")); });
    await flush();
    expect(calls).toEqual(["a", "a"]);
  });

  it("does not re-send a resolved stop or one still in flight on an online event", async () => {
    renderHook(() => useAccessResolver([stop("a"), stop("b", "done")], vi.fn()));
    await flush();
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await flush();
    expect(calls).toEqual(["a"]);
  });

  describe("whenIdle", () => {
    it("is already idle with nothing to resolve", async () => {
      const { result } = renderHook(() => useAccessResolver([stop("a", "x")], vi.fn()));
      await flush();
      await expect(result.current.whenIdle(1000)).resolves.toBe(false);
    });

    it("waits for every pending resolve, queued ones included, then settles", async () => {
      const { result } = renderHook(() => useAccessResolver(["a", "b", "c", "d"].map((i) => stop(i)), vi.fn()));
      await flush();
      let done = false;
      void result.current.whenIdle(60_000).then(() => { done = true; });
      await flush();
      expect(done).toBe(false);
      let guard = 0;
      while (pending.length && guard++ < 10) {
        expect(done).toBe(false);
        await act(async () => { pending.shift()!.resolve(stop("x", "now")); });
        await flush();
      }
      expect(done).toBe(true);
    });

    it("gives up after the cap when resolves never finish", async () => {
      vi.useFakeTimers();
      try {
        const { result } = renderHook(() => useAccessResolver([stop("a")], vi.fn()));
        await flush();
        let done = false;
        void result.current.whenIdle(8000).then(() => { done = true; });
        await act(async () => { await vi.advanceTimersByTimeAsync(7999); });
        expect(done).toBe(false);
        await act(async () => { await vi.advanceTimersByTimeAsync(2); });
        expect(done).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
