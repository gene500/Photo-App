import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/hike/service", () => ({ lookupHikeStatus: vi.fn() }));
import { lookupHikeStatus } from "@/server/hike/service";
import { prisma } from "./db";
import { addStop } from "./stops";
import { createTrip } from "./trips";
import { resolveStopAccess } from "./stop-access";
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
  });

  it("saves the lot and marks the lookup finished", async () => {
    const { user, stop } = await oneStop();
    vi.mocked(lookupHikeStatus).mockResolvedValue({ hike: hike({ lat: 37.01, lng: -119.51, name: "North lot" }), failed: false });
    const out = await resolveStopAccess(user.id, stop.id);
    expect(out?.access).toEqual({ lat: 37.01, lng: -119.51, name: "North lot", walkMeters: 1235 }); // the hike's walk length, rounded
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
});
