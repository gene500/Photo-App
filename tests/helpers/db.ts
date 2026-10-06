import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";

export async function resetDb(): Promise<void> {
  await prisma.stop.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.user.deleteMany();
}

export async function createTestUser(email = `user-${randomUUID()}@example.com`) {
  const user = await prisma.user.create({ data: { email, passwordHash: "not-a-real-hash" } });
  return { id: user.id, email: user.email };
}

export const sampleTripInput = {
  name: "Sierra loop",
  start: { name: "Fresno, CA", lat: 36.7378, lng: -119.7871 },
  end: { name: "Lee Vining, CA", lat: 37.9577, lng: -119.1207 },
  plannedDate: "2026-07-01",
};
