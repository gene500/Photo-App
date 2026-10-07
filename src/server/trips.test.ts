import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { createTrip, deleteTrip, getTrip, listTrips, updateTrip } from "./trips";
import { createTestUser, resetDb, sampleTripInput } from "../../tests/helpers/db";

describe("trips data access", () => {
  beforeEach(resetDb);

  it("creates a trip and returns a DTO with a date-only plannedDate", async () => {
    const user = await createTestUser();
    const trip = await createTrip(user.id, sampleTripInput);
    expect(trip).toEqual({ id: expect.any(String), ...sampleTripInput });
  });

  it("lists only the caller's trips with stop counts, newest first", async () => {
    const me = await createTestUser();
    const other = await createTestUser();
    const older = await createTrip(me.id, { ...sampleTripInput, name: "Older" });
    const newer = await createTrip(me.id, { ...sampleTripInput, name: "Newer" });
    await prisma.trip.update({ where: { id: older.id }, data: { updatedAt: new Date("2026-01-01") } });
    await prisma.stop.create({ data: { tripId: newer.id, order: 0, name: "s", lat: 1, lng: 1, source: "manual" } });
    await createTrip(other.id, { ...sampleTripInput, name: "Not mine" });

    const list = await listTrips(me.id);
    expect(list.map((t) => t.name)).toEqual(["Newer", "Older"]);
    expect(list[0].stopCount).toBe(1);
    expect(typeof list[0].updatedAt).toBe("string");
  });

  it("returns null when getting another user's trip", async () => {
    const owner = await createTestUser();
    const intruder = await createTestUser();
    const trip = await createTrip(owner.id, sampleTripInput);
    expect(await getTrip(intruder.id, trip.id)).toBeNull();
  });

  it("returns stops ordered by order", async () => {
    const user = await createTestUser();
    const trip = await createTrip(user.id, sampleTripInput);
    await prisma.stop.create({ data: { tripId: trip.id, order: 1, name: "second", lat: 1, lng: 1, source: "manual" } });
    await prisma.stop.create({ data: { tripId: trip.id, order: 0, name: "first", lat: 1, lng: 1, source: "suggested" } });
    const loaded = await getTrip(user.id, trip.id);
    expect(loaded!.stops.map((s) => s.name)).toEqual(["first", "second"]);
    expect(loaded!.stops[0]).toMatchObject({ source: "suggested", visited: false, notes: null, photoUrl: null });
  });

  it("patches only the given fields and refuses non-owners", async () => {
    const user = await createTestUser();
    const intruder = await createTestUser();
    const trip = await createTrip(user.id, sampleTripInput);
    const updated = await updateTrip(user.id, trip.id, { name: "Renamed", plannedDate: "2026-08-15" });
    expect(updated).toEqual({ ...trip, name: "Renamed", plannedDate: "2026-08-15" });
    expect(await updateTrip(intruder.id, trip.id, { name: "Hijacked" })).toBeNull();
  });

  it("deletes a trip, returning its stops' photo URLs, and refuses non-owners", async () => {
    const user = await createTestUser();
    const intruder = await createTestUser();
    const trip = await createTrip(user.id, sampleTripInput);
    await prisma.stop.create({
      data: { tripId: trip.id, order: 0, name: "s", lat: 1, lng: 1, source: "manual", photoUrl: "/api/uploads/x.png" },
    });
    expect(await deleteTrip(intruder.id, trip.id)).toBeNull();
    expect(await deleteTrip(user.id, trip.id)).toEqual({ photoUrls: ["/api/uploads/x.png"] });
    expect(await prisma.trip.count()).toBe(0);
  });
});
