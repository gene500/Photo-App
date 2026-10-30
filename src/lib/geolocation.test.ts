// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPosition } from "./geolocation";

function setGeo(value: unknown) {
  Object.defineProperty(navigator, "geolocation", { value, configurable: true });
}
afterEach(() => {
  setGeo(undefined);
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  vi.restoreAllMocks();
});

describe("getPosition", () => {
  it("returns a rounded position and asks for low accuracy, 8 s, 60 s old", async () => {
    const get = vi.fn<Geolocation["getCurrentPosition"]>((ok) => ok({ coords: { latitude: 37.123456, longitude: -119.987654 } } as GeolocationPosition));
    setGeo({ getCurrentPosition: get });
    expect(await getPosition()).toEqual({ ok: true, lat: 37.1235, lng: -119.9877 });
    expect(get.mock.calls[0]![2]).toEqual({ enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
  });
  it.each([[1, "denied"], [2, "unavailable"], [3, "timeout"]] as const)("maps error code %i to %s", async (code, reason) => {
    setGeo({ getCurrentPosition: (_ok: PositionCallback, err: PositionErrorCallback) => err({ code } as GeolocationPositionError) });
    expect(await getPosition()).toEqual({ ok: false, reason });
  });
  it("is unsupported without navigator.geolocation or on an insecure origin", async () => {
    expect(await getPosition()).toEqual({ ok: false, reason: "unsupported" });
    setGeo({ getCurrentPosition: vi.fn() });
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    expect(await getPosition()).toEqual({ ok: false, reason: "unsupported" });
  });
  it("treats a throwing API or garbage coordinates as unavailable", async () => {
    setGeo({ getCurrentPosition: () => { throw new Error("x"); } });
    expect(await getPosition()).toEqual({ ok: false, reason: "unavailable" });
    setGeo({ getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: NaN, longitude: 0 } } as GeolocationPosition) });
    expect(await getPosition()).toEqual({ ok: false, reason: "unavailable" });
  });
  it("gives up after about 10 s when the browser never calls back (dismissed prompt)", async () => {
    vi.useFakeTimers();
    try {
      setGeo({ getCurrentPosition: vi.fn() });
      const p = getPosition();
      await vi.advanceTimersByTimeAsync(9_900);
      let done = false;
      void p.then(() => (done = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(await p).toEqual({ ok: false, reason: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });
  it("a late callback after giving up changes nothing", async () => {
    vi.useFakeTimers();
    try {
      let ok!: PositionCallback;
      setGeo({ getCurrentPosition: (cb: PositionCallback) => (ok = cb) });
      const p = getPosition();
      await vi.advanceTimersByTimeAsync(10_001);
      expect(await p).toEqual({ ok: false, reason: "timeout" });
      expect(() => ok({ coords: { latitude: 1, longitude: 1 } } as GeolocationPosition)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
