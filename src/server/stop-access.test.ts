import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/hike/service", () => ({ lookupHikeStatus: vi.fn() }));
vi.mock("@/server/hike/road-end-lookup", async (orig) => ({ ...(await orig<typeof import("@/server/hike/road-end-lookup")>()), lookupRoadEnd: vi.fn() }));
vi.mock("@/server/external/mapbox", async (orig) => ({ ...(await orig<typeof import("@/server/external/mapbox")>()), getWalkingTrail: vi.fn() }));
vi.mock("@/server/budget", () => ({ spendUserShare: vi.fn() }));
vi.mock("@/lib/access-trail", async (orig) => ({ ...(await orig<typeof import("@/lib/access-trail")>()), serializeAccessTrail: vi.fn((await orig<typeof import("@/lib/access-trail")>()).serializeAccessTrail) }));
import { lookupHikeStatus } from "@/server/hike/service";
import { lookupRoadEnd } from "@/server/hike/road-end-lookup";
import { getWalkingTrail, ExternalServiceError } from "@/server/external/mapbox";
import { spendUserShare } from "@/server/budget";
import { HttpError } from "./http-error";
import { parseAccessTrail, serializeAccessTrail } from "@/lib/access-trail";
import { prisma } from "./db";
import { addStop } from "./stops";
import { createTrip } from "./trips";
import { ACCESS_DEADLINE_MS, resolveStopAccess } from "./stop-access";
import { DEFAULT_TIMEOUT_MS } from "@/lib/api-client";
import { createTestUser, resetDb, sampleTripInput } from "../../tests/helpers/db";

const hike = (access: { lat: number; lng: number; name: string | null } | null) =>
  ({ distanceMeters: 1234.6, geometry: [[-119.5, 37]], source: "osm", attribution: "x", access }) as never;

async function oneStop() {
  const user = await createTestUser();
  const trip = await createTrip(user.id, sampleTripInput);
  const stop = (await addStop(user.id, trip.id, { name: "a", lat: 37, lng: -119.5, source: "manual" }))!;
  return { user, stop };
}

describe("resolveStopAccess", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(lookupHikeStatus).mockReset();
    vi.mocked(lookupRoadEnd).mockReset();
    vi.mocked(getWalkingTrail).mockReset();
    vi.mocked(spendUserShare).mockReset();
    vi.mocked(lookupHikeStatus).mockResolvedValue({ hike: null, failed: false });
    vi.mocked(lookupRoadEnd).mockResolvedValue({ result: { kind: "none" }, failed: false });
  });

  it("saves the lot and marks the lookup finished", async () => {
    const { user, stop } = await oneStop();
    vi.mocked(lookupHikeStatus).mockResolvedValue({ hike: hike({ lat: 37.01, lng: -119.51, name: "North lot" }), failed: false });
    const out = await resolveStopAccess(user.id, stop.id);
    expect(out?.access).toEqual({ lat: 37.01, lng: -119.51, name: "North lot", walkMeters: 1235, kind: "lot", trail: null }); // the hike's walk length, rounded
    expect(out?.accessResolvedAt).not.toBeNull();
  });

  it("marks finished with no lot when the hike has none", async () => {
    const { user, stop } = await oneStop();
    vi.mocked(lookupHikeStatus).mockResolvedValue({ hike: hike(null), failed: false });
    const out = await resolveStopAccess(user.id, stop.id);
    expect(out?.access).toBeNull();
    expect(out?.accessResolvedAt).not.toBeNull();
    expect((await prisma.stop.findUnique({ where: { id: stop.id } }))?.accessWalkMeters).toBeNull();
  });

  it("marks finished when there is no hike at all", async () => {
    const { user, stop } = await oneStop();
    vi.mocked(lookupHikeStatus).mockResolvedValue({ hike: null, failed: false });
    expect((await resolveStopAccess(user.id, stop.id))?.accessResolvedAt).not.toBeNull();
  });

  it("gives up at its own deadline (before the client's timeout) and saves nothing, even if the lookup answers later", async () => {
    expect(ACCESS_DEADLINE_MS).toBeLessThan(DEFAULT_TIMEOUT_MS);
    const { user, stop } = await oneStop();
    let answer!: (v: Awaited<ReturnType<typeof lookupHikeStatus>>) => void;
    vi.mocked(lookupHikeStatus).mockReturnValue(new Promise((r) => { answer = r; }));
    const out = await resolveStopAccess(user.id, stop.id, 30);
    expect(out).toMatchObject({ id: stop.id, access: null, accessResolvedAt: null });
    answer({ hike: hike({ lat: 37.01, lng: -119.51, name: "Late lot" }), failed: false });
    await new Promise((r) => setTimeout(r, 20));
    const row = await prisma.stop.findUnique({ where: { id: stop.id } });
    expect(row?.accessResolvedAt).toBeNull();
    expect(row?.accessLat).toBeNull();
  });

  it("leaves everything null when the service failed", async () => {
    const { user, stop } = await oneStop();
    vi.mocked(lookupHikeStatus).mockResolvedValue({ hike: null, failed: true });
    const out = await resolveStopAccess(user.id, stop.id);
    expect(out).toMatchObject({ id: stop.id, access: null, accessResolvedAt: null });
  });

  it("leaves accessResolvedAt null when the hike came back but the lookup failed (OSM down, NPS answered)", async () => {
    const { user, stop } = await oneStop();
    vi.mocked(lookupHikeStatus).mockResolvedValue({ hike: hike(null), failed: true });
    const out = await resolveStopAccess(user.id, stop.id);
    expect(out).toMatchObject({ access: null, accessResolvedAt: null });
  });

  it("returns null and writes nothing for another user's stop", async () => {
    const { stop } = await oneStop();
    const other = await createTestUser();
    expect(await resolveStopAccess(other.id, stop.id)).toBeNull();
    expect(lookupHikeStatus).not.toHaveBeenCalled();
    expect((await prisma.stop.findUnique({ where: { id: stop.id } }))?.accessResolvedAt).toBeNull();
  });

  it("does not overwrite when the stop moved during the lookup", async () => {
    const { user, stop } = await oneStop();
    vi.mocked(lookupHikeStatus).mockImplementation(async () => {
      await prisma.stop.update({ where: { id: stop.id }, data: { lat: 38 } });
      return { hike: hike({ lat: 37.01, lng: -119.51, name: "Old lot" }), failed: false };
    });
    const out = await resolveStopAccess(user.id, stop.id);
    expect(out).toMatchObject({ lat: 38, access: null, accessResolvedAt: null });
  });

  it("trims the name to 120 characters and stores blank as null", async () => {
    const { user, stop } = await oneStop();
    vi.mocked(lookupHikeStatus).mockResolvedValue({ hike: hike({ lat: 37.01, lng: -119.51, name: `  ${"x".repeat(200)}  ` }), failed: false });
    expect((await resolveStopAccess(user.id, stop.id))?.access?.name).toBe("x".repeat(120));
    vi.mocked(lookupHikeStatus).mockResolvedValue({ hike: hike({ lat: 37.01, lng: -119.51, name: "   " }), failed: false });
    expect((await resolveStopAccess(user.id, stop.id))?.access?.name).toBeNull();
  });

  it("stores null for a lot name made only of zero-width characters", async () => {
    const { user, stop } = await oneStop();
    vi.mocked(lookupHikeStatus).mockResolvedValue({ hike: hike({ lat: 37.01, lng: -119.51, name: "\u200B\u200D" }), failed: false });
    await resolveStopAccess(user.id, stop.id);
    expect((await prisma.stop.findUnique({ where: { id: stop.id } }))?.accessName).toBeNull();
  });

  it("saves a cleaned name: no control or bidi characters, and an emoji is never split at 120", async () => {
    const { user, stop } = await oneStop();
    vi.mocked(lookupHikeStatus).mockResolvedValue({ hike: hike({ lat: 37.01, lng: -119.51, name: "No\u0000rth\u202E lot" }), failed: false });
    await resolveStopAccess(user.id, stop.id);
    expect((await prisma.stop.findUnique({ where: { id: stop.id } }))?.accessName).toBe("North lot");
    vi.mocked(lookupHikeStatus).mockResolvedValue({ hike: hike({ lat: 37.01, lng: -119.51, name: "x".repeat(119) + "\u{1F600}" }), failed: false });
    await resolveStopAccess(user.id, stop.id);
    expect((await prisma.stop.findUnique({ where: { id: stop.id } }))?.accessName).toBe("x".repeat(119));
  });
  describe("road end (no lot)", () => {
    const trail: [number, number][] = [[-119.5, 37.0097], [-119.5, 37.005], [-119.5, 37]];
    const roadEnd = (t: [number, number][] | null) => ({ result: { kind: "road-end" as const, point: [-119.5, 37.0097] as [number, number], trail: t, walkMeters: 1071 }, failed: false });
    const savedRow = (id: string) => prisma.stop.findUnique({ where: { id } });

    it("saves a road end with its trail and does not call Mapbox", async () => {
      const { user, stop } = await oneStop();
      vi.mocked(lookupRoadEnd).mockResolvedValue(roadEnd(trail));
      const out = await resolveStopAccess(user.id, stop.id);
      const row = await savedRow(stop.id);
      expect(row).toMatchObject({ accessKind: "road-end", accessName: "Road end", accessLat: 37.0097, accessLng: -119.5, accessWalkMeters: 1070 });
      expect(row?.accessResolvedAt).not.toBeNull();
      expect(parseAccessTrail(row?.accessTrail)).toEqual(trail);
      expect(out?.access?.kind).toBe("road-end");
      expect(out?.access?.trail).toEqual(trail);
      expect(getWalkingTrail).not.toHaveBeenCalled();
      expect(spendUserShare).not.toHaveBeenCalled();
    });

    it("near-road saves only accessResolvedAt", async () => {
      const { user, stop } = await oneStop();
      vi.mocked(lookupRoadEnd).mockResolvedValue({ result: { kind: "near-road" }, failed: false });
      const out = await resolveStopAccess(user.id, stop.id);
      const row = await savedRow(stop.id);
      expect(row?.accessResolvedAt).not.toBeNull();
      expect(row).toMatchObject({ accessKind: null, accessName: null, accessLat: null, accessLng: null, accessWalkMeters: null, accessTrail: null });
      expect(out?.access).toBeNull();
    });

    it("no trail and no Mapbox path: saves the road end with the straight distance, spending once", async () => {
      const { user, stop } = await oneStop();
      vi.mocked(lookupRoadEnd).mockResolvedValue(roadEnd(null));
      vi.mocked(getWalkingTrail).mockResolvedValue(null);
      await resolveStopAccess(user.id, stop.id);
      const row = await savedRow(stop.id);
      expect(row).toMatchObject({ accessKind: "road-end", accessWalkMeters: 1070, accessTrail: null });
      expect(spendUserShare).toHaveBeenCalledTimes(1);
      expect(spendUserShare).toHaveBeenCalledWith("mapbox-directions", user.id);
      expect(getWalkingTrail).toHaveBeenCalledWith([-119.5, 37.0097], [-119.5, 37]);
    });

    it("no trail, Mapbox returns a 700 m path: saves that trail (<= 120 points) and walk", async () => {
      const { user, stop } = await oneStop();
      vi.mocked(lookupRoadEnd).mockResolvedValue(roadEnd(null));
      const geometry = Array.from({ length: 400 }, (_, i) => [-119.5 + Math.sin(i / 20) * 0.0004, 37.0097 - (i / 399) * 0.0097] as [number, number]);
      vi.mocked(getWalkingTrail).mockResolvedValue({ geometry, distanceMeters: 700 });
      await resolveStopAccess(user.id, stop.id);
      const row = await savedRow(stop.id);
      const saved = parseAccessTrail(row?.accessTrail);
      expect(saved).not.toBeNull();
      expect(saved!.length).toBeLessThanOrEqual(120);
      expect(row?.accessWalkMeters).toBe(700);
    });

    it("a failed road lookup saves nothing and a retry then saves it", async () => {
      const { user, stop } = await oneStop();
      vi.mocked(lookupRoadEnd).mockResolvedValue({ result: null, failed: true });
      const first = await resolveStopAccess(user.id, stop.id);
      expect(first?.accessResolvedAt).toBeNull();
      expect(await savedRow(stop.id)).toMatchObject({ accessKind: null, accessLat: null, accessResolvedAt: null });
      vi.mocked(lookupRoadEnd).mockResolvedValue(roadEnd(trail));
      const second = await resolveStopAccess(user.id, stop.id);
      expect(second?.access?.kind).toBe("road-end");
    });

    it("a failed hike lookup with no lot never calls the road lookup", async () => {
      const { user, stop } = await oneStop();
      vi.mocked(lookupHikeStatus).mockResolvedValue({ hike: null, failed: true });
      await resolveStopAccess(user.id, stop.id);
      expect(lookupRoadEnd).not.toHaveBeenCalled();
      expect((await savedRow(stop.id))?.accessResolvedAt).toBeNull();
    });

    it("a resolved lot wins over a road end", async () => {
      const { user, stop } = await oneStop();
      vi.mocked(lookupHikeStatus).mockResolvedValue({ hike: hike({ lat: 37.01, lng: -119.51, name: "North lot" }), failed: false });
      vi.mocked(lookupRoadEnd).mockResolvedValue(roadEnd(trail));
      await resolveStopAccess(user.id, stop.id);
      expect(await savedRow(stop.id)).toMatchObject({ accessKind: null, accessTrail: null, accessName: "North lot" });
      expect(lookupRoadEnd).not.toHaveBeenCalled();
    });

    it.each([
      ["HttpError 429", () => new HttpError(429, "Too many")],
      ["HttpError 503", () => new HttpError(503, "Off")],
      ["ExternalServiceError", () => new ExternalServiceError("down")],
    ])("Mapbox walking failure (%s) saves nothing", async (_n, make) => {
      const { user, stop } = await oneStop();
      vi.mocked(lookupRoadEnd).mockResolvedValue(roadEnd(null));
      vi.mocked(getWalkingTrail).mockRejectedValue(make());
      const out = await resolveStopAccess(user.id, stop.id);
      expect(out).toMatchObject({ access: null, accessResolvedAt: null });
      expect(await savedRow(stop.id)).toMatchObject({ accessKind: null, accessResolvedAt: null });
    });

    it("a refused budget spend saves nothing and does not call Mapbox", async () => {
      const { user, stop } = await oneStop();
      vi.mocked(lookupRoadEnd).mockResolvedValue(roadEnd(null));
      vi.mocked(spendUserShare).mockRejectedValue(new HttpError(429, "Limit"));
      const out = await resolveStopAccess(user.id, stop.id);
      expect(out?.accessResolvedAt).toBeNull();
      expect(getWalkingTrail).not.toHaveBeenCalled();
    });

    it("spends the requesting user's share before the walking call; a 429 refusal saves nothing and stays retryable", async () => {
      const { user, stop } = await oneStop();
      vi.mocked(lookupRoadEnd).mockResolvedValue(roadEnd(null));
      const order: string[] = [];
      vi.mocked(spendUserShare).mockImplementation(async () => { order.push("spend"); });
      vi.mocked(getWalkingTrail).mockImplementation(async () => { order.push("walk"); return null; });
      await resolveStopAccess(user.id, stop.id);
      expect(spendUserShare).toHaveBeenCalledWith("mapbox-directions", user.id);
      expect(order).toEqual(["spend", "walk"]);
      await prisma.stop.update({ where: { id: stop.id }, data: { accessResolvedAt: null, accessKind: null, accessLat: null, accessLng: null, accessName: null, accessWalkMeters: null } });
      vi.mocked(getWalkingTrail).mockClear();
      vi.mocked(spendUserShare).mockRejectedValue(new HttpError(429, "Limit"));
      const out = await resolveStopAccess(user.id, stop.id);
      expect(out).toMatchObject({ access: null, accessResolvedAt: null });
      expect(await savedRow(stop.id)).toMatchObject({ accessKind: null, accessResolvedAt: null });
      expect(getWalkingTrail).not.toHaveBeenCalled();
      vi.mocked(spendUserShare).mockResolvedValue(undefined as never);
      expect((await resolveStopAccess(user.id, stop.id))?.access?.kind).toBe("road-end");
    });

    it("concurrent resolves of the same stop share one spend and one walking call; a later call after a failure runs again", async () => {
      const { user, stop } = await oneStop();
      vi.mocked(lookupRoadEnd).mockResolvedValue(roadEnd(null));
      let finish!: (v: null) => void;
      vi.mocked(getWalkingTrail).mockReturnValueOnce(new Promise((r) => { finish = r; }));
      const a = resolveStopAccess(user.id, stop.id);
      const b = resolveStopAccess(user.id, stop.id);
      await new Promise((r) => setTimeout(r, 50));
      finish(null);
      const [ra, rb] = await Promise.all([a, b]);
      expect(ra?.access?.kind).toBe("road-end");
      expect(rb?.access?.kind).toBe("road-end");
      expect(getWalkingTrail).toHaveBeenCalledTimes(1);
      expect(spendUserShare).toHaveBeenCalledTimes(1);

      await prisma.stop.update({ where: { id: stop.id }, data: { accessResolvedAt: null, accessKind: null, accessLat: null, accessLng: null, accessName: null, accessWalkMeters: null } });
      vi.mocked(getWalkingTrail).mockRejectedValueOnce(new ExternalServiceError("down"));
      expect((await resolveStopAccess(user.id, stop.id))?.accessResolvedAt).toBeNull();
      vi.mocked(getWalkingTrail).mockResolvedValueOnce(null);
      expect((await resolveStopAccess(user.id, stop.id))?.access?.kind).toBe("road-end");
      expect(getWalkingTrail).toHaveBeenCalledTimes(3);
    });

    it("releases the in-flight slot after the deadline fires so a retry runs again", async () => {
      const { user, stop } = await oneStop();
      vi.mocked(lookupRoadEnd).mockReturnValueOnce(new Promise(() => {}));
      expect((await resolveStopAccess(user.id, stop.id, 20))?.accessResolvedAt).toBeNull();
      vi.mocked(lookupRoadEnd).mockResolvedValue(roadEnd(trail));
      expect((await resolveStopAccess(user.id, stop.id))?.access?.kind).toBe("road-end");
    });

    it("a Mapbox trail that is over the character cap at 120 points is re-simplified to 60 and saved", async () => {
      const { user, stop } = await oneStop();
      vi.mocked(lookupRoadEnd).mockResolvedValue(roadEnd(null));
      const geometry = Array.from({ length: 400 }, (_, i) => [-119.5 + Math.sin(i / 20) * 0.0004, 37.0097 - (i / 399) * 0.0097] as [number, number]);
      vi.mocked(getWalkingTrail).mockResolvedValue({ geometry, distanceMeters: 700 });
      const real = vi.mocked(serializeAccessTrail).getMockImplementation()!;
      vi.mocked(serializeAccessTrail).mockImplementation((t) => (t && t.length > 60 ? null : real(t)));
      try {
        await resolveStopAccess(user.id, stop.id);
      } finally {
        vi.mocked(serializeAccessTrail).mockImplementation(real);
      }
      const row = await savedRow(stop.id);
      const saved = parseAccessTrail(row?.accessTrail);
      expect(saved).not.toBeNull();
      expect(saved!.length).toBeLessThanOrEqual(60);
      expect(row!.accessTrail!.length).toBeLessThanOrEqual(4000);
    });

    it("logs a non-HttpError (message only) and still reports failed", async () => {
      const { user, stop } = await oneStop();
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(lookupRoadEnd).mockRejectedValue(new TypeError("boom https://x.test/?access_token=SECRET"));
      expect((await resolveStopAccess(user.id, stop.id))?.accessResolvedAt).toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockClear();
      vi.mocked(lookupRoadEnd).mockResolvedValue(roadEnd(null));
      vi.mocked(getWalkingTrail).mockRejectedValue(new HttpError(503, "Off"));
      await resolveStopAccess(user.id, stop.id);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("drops the answer when the stop moved during the road lookup", async () => {
      const { user, stop } = await oneStop();
      vi.mocked(lookupRoadEnd).mockImplementation(async () => {
        await prisma.stop.update({ where: { id: stop.id }, data: { lat: 38 } });
        return roadEnd(trail);
      });
      const out = await resolveStopAccess(user.id, stop.id);
      expect(out).toMatchObject({ lat: 38, access: null, accessResolvedAt: null });
    });

    it("a road lookup that never resolves hits the deadline and saves nothing", async () => {
      const { user, stop } = await oneStop();
      vi.mocked(lookupRoadEnd).mockReturnValue(new Promise(() => {}));
      const out = await resolveStopAccess(user.id, stop.id, 20);
      expect(out).toMatchObject({ id: stop.id, access: null, accessResolvedAt: null });
      expect(await savedRow(stop.id)).toMatchObject({ accessKind: null, accessResolvedAt: null });
    });
  });
});
