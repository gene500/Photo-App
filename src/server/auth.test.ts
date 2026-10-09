import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authOptions, authorizeCredentials } from "./auth";
import { clearAllLimits } from "./rate-limit";
import { createUser, revokeAllSessions } from "./users";
import { prisma } from "./db";
import { resetDb } from "../../tests/helpers/db";

describe("auth", () => {
  beforeEach(resetDb);

  it("uses JWT sessions and the /login page", () => {
    expect(authOptions.session?.strategy).toBe("jwt");
    expect(authOptions.pages?.signIn).toBe("/login");
  });

  it("authorizes valid credentials and rejects missing fields", async () => {
    const user = await createUser("ann@example.com", "correct-horse");
    expect(await authorizeCredentials({ email: "ann@example.com", password: "correct-horse" })).toEqual(user);
    expect(await authorizeCredentials({ email: "ann@example.com" })).toBeNull();
    expect(await authorizeCredentials(undefined)).toBeNull();
  });

  const sessionOf = (token: JWT) =>
    authOptions.callbacks!.session!({ session: { user: {}, expires: "x" } as Session, token } as never) as Promise<Session>;
  const tokenFor = async (id: string) =>
    authOptions.callbacks!.jwt!({ token: {}, user: { id } } as never) as Promise<JWT>;

  it("a token keeps working until the user's session version is bumped", async () => {
    const user = await createUser("ann@example.com", "correct-horse");
    const token = await tokenFor(user.id);
    expect(token.sv).toBe(0);
    expect((await sessionOf(token)).user?.id).toBe(user.id);
    await revokeAllSessions(user.id);
    expect((await sessionOf(token)).user).toBeUndefined();
    // A fresh sign-in after the bump is valid again.
    expect((await sessionOf(await tokenFor(user.id))).user?.id).toBe(user.id);
  });

  it("treats tokens issued before versioning (no sv) as version 0", async () => {
    const user = await createUser("ann@example.com", "correct-horse");
    expect((await sessionOf({ sub: user.id })).user?.id).toBe(user.id);
  });

  it("a token for a deleted user yields no session", async () => {
    const user = await createUser("ann@example.com", "correct-horse");
    const token = await tokenFor(user.id);
    await prisma.user.delete({ where: { id: user.id } });
    expect((await sessionOf(token)).user).toBeUndefined();
  });

  describe("per-email login throttle", () => {
    beforeEach(() => {
      process.env.RATE_LIMIT_DISABLED = "";
      clearAllLimits();
    });
    afterEach(() => {
      process.env.RATE_LIMIT_DISABLED = "1";
    });

    it("blocks after repeated failures, even with the right password, and a success clears the count", async () => {
      await createUser("ann@example.com", "correct-horse");
      for (let i = 0; i < 3; i++) await authorizeCredentials({ email: "ann@example.com", password: "nope-nope" });
      expect(await authorizeCredentials({ email: "ann@example.com", password: "correct-horse" })).not.toBeNull();
      for (let i = 0; i < 8; i++) await authorizeCredentials({ email: "Ann@Example.com", password: "nope-nope" });
      await expect(authorizeCredentials({ email: "ann@example.com", password: "correct-horse" })).rejects.toThrow("RateLimited");
    });
  });
});
