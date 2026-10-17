import { beforeEach, describe, expect, it } from "vitest";
import { shiftDepartAtLocal } from "@/lib/dates";
import { prisma } from "./db";
import { createTrip, deleteTrip, DepartAtMismatchError, getTrip, listTrips, updateTrip } from "./trips";
import { createTestUser, resetDb, sampleTripInput } from "../../tests/helpers/db";

describe("trips data access", () => {
  beforeEach(resetDb);

  it("creates a trip and returns a DTO with a date-only plannedDate", async () => {
    const user = await createTestUser();
    const trip = await createTrip(user.id, sampleTripInput);
    expect(trip).toEqual({ id: expect.any(String), ...sampleTripInput, departAt: null, shareToken: null });
  });

  it("sets and clears departAt as an ISO string", async () => {
    const user = await createTestUser();
    const trip = await createTrip(user.id, sampleTripInput);
    const set = await updateTrip(user.id, trip.id, { departAt: "2026-07-01T17:42:00.000Z" });
    expect(set?.departAt).toBe("2026-07-01T17:42:00.000Z");
    expect((await updateTrip(user.id, trip.id, { departAt: null }))?.departAt).toBeNull();
  });

  it("only checks a start time against the planned day when it changes (Undo of a legacy mismatched value still saves)", async () => {
    const user = await createTestUser();
    const trip = await createTrip(user.id, sampleTripInput);
    const legacy = "2030-01-01T12:00:00.000Z"; // days away from the planned day
    await prisma.trip.update({ where: { id: trip.id }, data: { departAt: new Date(legacy) } });
    const same = await updateTrip(user.id, trip.id, { departAt: legacy });
    expect(same?.departAt).toBe(legacy);
    await expect(updateTrip(user.id, trip.id, { departAt: "2030-01-02T12:00:00.000Z" })).rejects.toBeInstanceOf(DepartAtMismatchError);
  });

  it("saves a rename plus date change when the stored start time is a legacy off-day value (the shifted value is not validated)", async () => {
    const user = await createTestUser();
    const trip = await createTrip(user.id, sampleTripInput);
    const legacy = "2030-01-01T12:00:00.000Z";
    await prisma.trip.update({ where: { id: trip.id }, data: { departAt: new Date(legacy) } });
    const shifted = shiftDepartAtLocal(legacy, sampleTripInput.plannedDate, "2026-07-05");
    const saved = await updateTrip(user.id, trip.id, { name: "Renamed", plannedDate: "2026-07-05", departAt: shifted });
    expect(saved?.name).toBe("Renamed");
    expect(saved?.plannedDate).toBe("2026-07-05");
    expect(saved?.departAt).toBe(shifted);
  });

  it("with a date change, refuses a start time left on the old day (only the server's own shift or null is taken)", async () => {
    const user = await createTestUser();
    const trip = await createTrip(user.id, sampleTripInput);
    const stored = "2026-07-01T17:00:00.000Z";
    await prisma.trip.update({ where: { id: trip.id }, data: { departAt: new Date(stored) } });
    await expect(updateTrip(user.id, trip.id, { plannedDate: "2027-03-10", departAt: stored })).rejects.toBeInstanceOf(DepartAtMismatchError);
    await expect(updateTrip(user.id, trip.id, { plannedDate: "2027-03-10", departAt: "2026-07-01T09:00:00.000Z" })).rejects.toBeInstanceOf(DepartAtMismatchError);
    expect((await getTrip(user.id, trip.id))?.plannedDate).toBe("2026-07-01");
    const shifted = shiftDepartAtLocal(stored, "2026-07-01", "2027-03-10");
    expect((await updateTrip(user.id, trip.id, { plannedDate: "2027-03-10", departAt: shifted }))?.departAt).toBe(shifted);
  });

  it("saves an Undo to an earlier value on the same legacy off-day as the stored one", async () => {
    const user = await createTestUser();
    const trip = await createTrip(user.id, sampleTripInput);
    await prisma.trip.update({ where: { id: trip.id }, data: { departAt: new Date("2030-01-01T12:00:00.000Z") } });
    const earlier = "2030-01-01T09:30:00.000Z"; // differs from the stored value, same off-day
    expect((await updateTrip(user.id, trip.id, { departAt: earlier }))?.departAt).toBe(earlier);
    // A different off-day (neither the stored day nor the planned day) is still refused.
    await expect(updateTrip(user.id, trip.id, { departAt: "2030-03-01T09:30:00.000Z" })).rejects.toBeInstanceOf(DepartAtMismatchError);
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
