import { beforeEach, describe, expect, it } from "vitest";
import { createTrip, DepartAtMismatchError, updateTrip } from "./trips";
import { prisma } from "./db";
import { createTestUser, resetDb } from "../../tests/helpers/db";

// The shift is plain UTC date arithmetic, so the answers below must not depend on the machine's zone.
// Run this file under both to check: TZ=America/Los_Angeles and TZ=UTC.

describe("changing plannedDate through the API alone", () => {
  beforeEach(resetDb);

  it("moves by whole UTC days across a daylight-saving change, whatever the server's time zone", async () => {
    const user = await createTestUser();
    const trip = await createTrip(user.id, { name: "t", plannedDate: "2026-10-30", departAt: "2026-10-30T14:00:00.000Z" });
    const moved = await updateTrip(user.id, trip.id, { plannedDate: "2026-11-06" }); // US clocks change on 2026-11-01
    expect(moved?.departAt).toBe("2026-11-06T14:00:00.000Z");
  });

  it("moves by whole days when there is no daylight-saving change", async () => {
    const user = await createTestUser();
    const trip = await createTrip(user.id, { name: "t", plannedDate: "2026-10-30", departAt: "2026-10-30T14:00:00.000Z" });
    expect((await updateTrip(user.id, trip.id, { plannedDate: "2026-10-20" }))?.departAt).toBe("2026-10-20T14:00:00.000Z");
  });
});

describe("departAt must be on the planned day", () => {
  beforeEach(resetDb);
  const stopAt = (tripId: string, lng: number) => prisma.stop.create({ data: { tripId, order: 0, name: "s", lat: 40, lng, source: "manual" } });

  it("rejects a start time on another day when a trip is created", async () => {
    const user = await createTestUser();
    await expect(createTrip(user.id, { name: "t", plannedDate: "2026-07-01", departAt: "2026-07-05T12:00:00.000Z" })).rejects.toThrow(DepartAtMismatchError);
    await expect(createTrip(user.id, { name: "t", plannedDate: "2026-07-01", departAt: "2026-07-01T12:00:00.000Z" })).resolves.toBeTruthy();
  });

  it("accepts any instant that is the planned day somewhere on Earth while the trip has no stop", async () => {
    const user = await createTestUser();
    for (const departAt of ["2026-06-30T12:00:01.000Z", "2026-07-02T11:59:59.000Z"]) {
      await expect(createTrip(user.id, { name: "t", plannedDate: "2026-07-01", departAt })).resolves.toBeTruthy();
    }
    for (const departAt of ["2026-06-30T11:59:59.000Z", "2026-07-02T12:00:00.000Z"]) {
      await expect(createTrip(user.id, { name: "t", plannedDate: "2026-07-01", departAt })).rejects.toThrow(DepartAtMismatchError);
    }
  });

  it("checks the solar day at the first stop's longitude on update", async () => {
    const user = await createTestUser();
    const trip = await createTrip(user.id, { name: "t", plannedDate: "2026-07-01" });
    await stopAt(trip.id, 150); // Australia: 2026-07-01 there starts 2026-06-30T14:00Z
    expect((await updateTrip(user.id, trip.id, { departAt: "2026-06-30T20:00:00.000Z" }))?.departAt).toBe("2026-06-30T20:00:00.000Z");
    await expect(updateTrip(user.id, trip.id, { departAt: "2026-07-01T20:00:00.000Z" })).rejects.toThrow(/planned day/);
  });

  it("checks against the new plannedDate when both change, and clears with null", async () => {
    const user = await createTestUser();
    const trip = await createTrip(user.id, { name: "t", plannedDate: "2026-07-01" });
    await expect(updateTrip(user.id, trip.id, { plannedDate: "2026-07-10", departAt: "2026-07-01T12:00:00.000Z" })).rejects.toThrow(DepartAtMismatchError);
    expect((await updateTrip(user.id, trip.id, { plannedDate: "2026-07-10", departAt: "2026-07-10T12:00:00.000Z" }))?.departAt).toBe("2026-07-10T12:00:00.000Z");
    expect((await updateTrip(user.id, trip.id, { departAt: null }))?.departAt).toBeNull();
  });

  it("does not let an existing mismatched start time block an unrelated edit", async () => {
    const user = await createTestUser();
    const trip = await createTrip(user.id, { name: "t", plannedDate: "2026-07-01" });
    await prisma.trip.update({ where: { id: trip.id }, data: { departAt: new Date("2026-07-20T12:00:00.000Z") } });
    expect((await updateTrip(user.id, trip.id, { name: "renamed" }))?.name).toBe("renamed");
    expect((await updateTrip(user.id, trip.id, { plannedDate: "2026-07-02" }))?.departAt).toBe("2026-07-21T12:00:00.000Z");
  });
});
