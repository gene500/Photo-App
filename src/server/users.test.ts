import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { createUser, DuplicateEmailError, verifyCredentials } from "./users";
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
});
