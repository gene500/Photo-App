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
