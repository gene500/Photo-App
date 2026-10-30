import { afterEach, describe, expect, it, vi } from "vitest";
import { collectPlaceNotices } from "./place-notices";

const stop = { lat: 37.9, lng: -119.26 };
// Monday 2026-06-01 12:00 local at lng -119.26 (mean offset -8 h) is 20:00 UTC
const noonMon = Date.UTC(2026, 5, 1, 20);
const nps = (rows: { kind: "closed" | "alert"; text: string }[][]) => ({ alertsForPoints: vi.fn(async () => rows) });
const osm = (hours: (string | null)[]) => ({ hoursForPoints: vi.fn(async () => hours) });

afterEach(() => vi.unstubAllEnvs());

describe("collectPlaceNotices", () => {
  it("combines NPS alerts (closed first, capped) with OSM closed-at-arrival notes", async () => {
    const out = await collectPlaceNotices(
      [{ ...stop, arrivalMs: Date.UTC(2026, 5, 1, 4) }],
      "2026-06-01",
      { today: "2026-06-01", nps: nps([[{ kind: "alert", text: "a" }, { kind: "alert", text: "b" }, { kind: "alert", text: "c" }, { kind: "closed", text: "Tioga Road closed (NPS alert)" }]]), osm: osm(["Mo-Su 09:00-17:00"]) },
    );
    expect(out.filter((n) => n.source === "NPS").map((n) => n.text)).toEqual(["Tioga Road closed (NPS alert)", "a", "b"]);
    expect(out.at(-1)).toMatchObject({ stopIndex: 0, kind: "closed", source: "OpenStreetMap" });
    expect(out.at(-1)!.text).toContain("open 09:00-17:00");
  });
  it("says nothing when open, flags a day off, and flags near-the-edge as hours", async () => {
    const d = { today: "2026-06-01", nps: nps([[]]) };
    expect(await collectPlaceNotices([{ ...stop, arrivalMs: noonMon }], "2026-06-01", { ...d, osm: osm(["Mo-Su 09:00-17:00"]) })).toEqual([]);
    expect((await collectPlaceNotices([{ ...stop, arrivalMs: noonMon }], "2026-06-01", { ...d, osm: osm(["Tu-Su 09:00-17:00"]) }))[0]!.text).toContain("closed on Monday");
    expect((await collectPlaceNotices([{ ...stop, arrivalMs: Date.UTC(2026, 5, 1, 16, 30) }], "2026-06-01", { ...d, osm: osm(["Mo-Su 09:00-17:00"]) }))[0]).toMatchObject({ kind: "hours" });
  });
  it("ignores hours it cannot read and skips unknown hours silently", async () => {
    const d = { today: "2026-06-01", nps: nps([[]]) };
    expect(await collectPlaceNotices([{ ...stop, arrivalMs: noonMon }], "2026-06-01", { ...d, osm: osm(["Apr-Oct Mo-Su 09:00-17:00"]) })).toEqual([]);
    expect(await collectPlaceNotices([{ ...stop, arrivalMs: noonMon }], "2026-06-01", { ...d, osm: osm([null]) })).toEqual([]);
  });
  it("skips hours for a non-finite arrival (no 'closed on undefined')", async () => {
    const o = osm(["Tu-Su 09:00-17:00"]);
    for (const arrivalMs of [NaN, Infinity]) {
      expect(await collectPlaceNotices([{ ...stop, arrivalMs }], "2026-06-01", { today: "2026-06-01", nps: nps([[]]), osm: o })).toEqual([]);
    }
    expect(o.hoursForPoints).not.toHaveBeenCalled();
  });
  it("does not name a closed day when the estimated clock is close to midnight", async () => {
    // Tuesday 00:30 local at lng -119.26 is 08:30 UTC; the real local time may still be Monday evening
    const out = await collectPlaceNotices([{ ...stop, arrivalMs: Date.UTC(2026, 5, 2, 8, 30) }], "2026-06-02", { today: "2026-06-02", nps: nps([[]]), osm: osm(["Mo-Fr 09:00-17:00; Tu off"]) });
    expect(out).toEqual([]);
  });
  it("does not ask NPS for a date far away, and does not ask OSM without an arrival", async () => {
    const n = nps([[{ kind: "closed", text: "x" }]]);
    const o = osm(["Mo-Su 09:00-17:00"]);
    expect(await collectPlaceNotices([stop], "2026-09-01", { today: "2026-06-01", nps: n, osm: o })).toEqual([]);
    expect(n.alertsForPoints).not.toHaveBeenCalled();
    expect(o.hoursForPoints).not.toHaveBeenCalled();
  });
  it("returns nothing when a source is too slow or throws", async () => {
    vi.useFakeTimers();
    const slow = { alertsForPoints: () => new Promise<never>(() => {}) };
    const p = collectPlaceNotices([stop], "2026-06-01", { today: "2026-06-01", nps: slow, osm: osm([]), deadlineMs: 50 });
    await vi.advanceTimersByTimeAsync(60);
    expect(await p).toEqual([]);
    vi.useRealTimers();
    const boom = { alertsForPoints: async () => { throw new Error("x"); } };
    expect(await collectPlaceNotices([stop], "2026-06-01", { today: "2026-06-01", nps: boom, osm: osm([]) })).toEqual([]);
  });
  it("uses canned data in fake-externals mode, with no network", async () => {
    vi.stubEnv("EXTERNAL_APIS_FAKE", "1");
    const f = vi.spyOn(globalThis, "fetch");
    const out = await collectPlaceNotices([{ lat: 37.91, lng: -119.26 }, { lat: 0, lng: 0 }], "2026-06-01");
    expect(out).toEqual([{ stopIndex: 0, kind: "closed", text: "Tioga Road: closed for the season (NPS alert)", source: "NPS" }]);
    expect(f).not.toHaveBeenCalled();
    f.mockRestore();
  });
});
