import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { createTestUser, resetDb } from "../../tests/helpers/db";

describe("prisma client", () => {
  beforeEach(resetDb);

  it("connects to the test database", async () => {
    await createTestUser("a@example.com");
    expect(await prisma.user.count()).toBe(1);
  });

  it("cascades user deletion to trips and stops", async () => {
    const user = await createTestUser();
    const trip = await prisma.trip.create({
      data: {
        userId: user.id, name: "t", startName: "A", startLat: 1, startLng: 1,
        endName: "B", endLat: 2, endLng: 2, plannedDate: new Date("2026-07-01T00:00:00Z"),
      },
    });
    await prisma.stop.create({
      data: { tripId: trip.id, order: 0, name: "s", lat: 1.5, lng: 1.5, source: "manual" },
    });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.trip.count()).toBe(0);
    expect(await prisma.stop.count()).toBe(0);
  });
});
