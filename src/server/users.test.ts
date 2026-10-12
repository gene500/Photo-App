import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./db";
import { changePassword, createUser, DuplicateEmailError, getSessionVersion, revokeAllSessions, verifyCredentials } from "./users";
import { resetDb } from "../../tests/helpers/db";

describe("users", () => {
  beforeEach(resetDb);

  it("stores a bcrypt hash, never the password, with a normalized email", async () => {
    const user = await createUser("  Ann@Example.COM ", "correct-horse");
    expect(user.email).toBe("ann@example.com");
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).not.toContain("correct-horse");
    expect(row.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it("rejects a duplicate email regardless of case", async () => {
    await createUser("ann@example.com", "correct-horse");
    await expect(createUser("ANN@example.com", "another-pass")).rejects.toBeInstanceOf(
      DuplicateEmailError,
    );
  });

  it("verifies the right password", async () => {
    const user = await createUser("ann@example.com", "correct-horse");
    expect(await verifyCredentials("Ann@Example.com", "correct-horse")).toEqual(user);
  });

  it("returns null for a wrong password or unknown email", async () => {
    await createUser("ann@example.com", "correct-horse");
    expect(await verifyCredentials("ann@example.com", "wrong-horse")).toBeNull();
    expect(await verifyCredentials("nobody@example.com", "correct-horse")).toBeNull();
  });

  it("still runs a bcrypt comparison when the email is unknown (no timing tell)", async () => {
    await createUser("ann@example.com", "correct-horse");
    const compare = vi.spyOn(bcrypt, "compare");
    await verifyCredentials("nobody@example.com", "whatever-pass");
    expect(compare).toHaveBeenCalledTimes(1);
    compare.mockRestore();
  });

  it("revokeAllSessions and changePassword bump the session version", async () => {
    const user = await createUser("ann@example.com", "correct-horse");
    expect(await getSessionVersion(user.id)).toBe(0);
    await revokeAllSessions(user.id);
    expect(await getSessionVersion(user.id)).toBe(1);
    expect(await changePassword(user.id, "wrong-password", "new-password-1")).toBe(false);
    expect(await getSessionVersion(user.id)).toBe(1);
    expect(await changePassword(user.id, "correct-horse", "new-password-1")).toBe(true);
    expect(await getSessionVersion(user.id)).toBe(2);
    expect(await verifyCredentials("ann@example.com", "new-password-1")).toEqual(user);
    expect(await verifyCredentials("ann@example.com", "correct-horse")).toBeNull();
    expect(await getSessionVersion("missing")).toBeNull();
  });
});

describe("deleteAccount", () => {
  beforeEach(resetDb);

  it("refuses a wrong password and keeps everything", async () => {
    const { deleteAccount } = await import("./users");
    const user = await createUser("del@example.com", "correct-horse");
    expect(await deleteAccount(user.id, "wrong-password")).toBeNull();
    expect(await prisma.user.count()).toBe(1);
  });

  it("deletes the user with trips and stops, returning photo urls", async () => {
    const { deleteAccount } = await import("./users");
    const user = await createUser("del2@example.com", "correct-horse");
    const other = await createUser("keep@example.com", "correct-horse");
    const trip = await prisma.trip.create({ data: { userId: user.id, name: "t", plannedDate: new Date("2026-07-01") } });
    await prisma.trip.create({ data: { userId: other.id, name: "keep", plannedDate: new Date("2026-07-01") } });
    await prisma.stop.create({ data: { tripId: trip.id, name: "s", lat: 1, lng: 2, order: 0, source: "manual", photoUrl: "/api/uploads/a.jpg" } });
    expect(await deleteAccount(user.id, "correct-horse")).toEqual({ photoUrls: ["/api/uploads/a.jpg"] });
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.stop.count()).toBe(0);
    expect(await prisma.trip.count()).toBe(1);
    expect(await getSessionVersion(user.id)).toBeNull();
  });
});
