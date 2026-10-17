import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authOptions, authorizeCredentials } from "./auth";
import { clearAllLimits } from "./rate-limit";
import * as users from "./users";
import { clearSessionVersionCache, createUser, revokeAllSessions } from "./users";
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

  it("stamps authTime on sign-in only, and exposes it on the session", async () => {
    const user = await createUser("ann@example.com", "correct-horse");
    const before = Date.now();
    const token = await tokenFor(user.id);
    expect(token.authTime).toBeGreaterThanOrEqual(before);
    // An ordinary token read (no `user`) must not refresh it.
    const reread = (await authOptions.callbacks!.jwt!({ token: { ...token, authTime: 5 } } as never)) as JWT;
    expect(reread.authTime).toBe(5);
    expect((await sessionOf(token) as Session & { authTime?: number }).authTime).toBe(token.authTime);
  });

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
    clearSessionVersionCache(); // what the 15 s expiry does on its own
    expect((await sessionOf(token)).user).toBeUndefined();
  });

  it("looks the session version up once per 15 s, not on every request, and a revoke on this instance shows at once", async () => {
    const user = await createUser("ann@example.com", "correct-horse");
    const token = await tokenFor(user.id);
    const find = vi.spyOn(prisma.user, "findUnique");
    await sessionOf(token);
    await sessionOf(token);
    await sessionOf(token);
    expect(find).not.toHaveBeenCalled(); // already remembered from the sign-in above
    await revokeAllSessions(user.id);
    expect((await sessionOf(token)).user).toBeUndefined();
    find.mockRestore();
  });

  // Each failed attempt runs a bcrypt compare; eight of them plus a final one can outlast the default 5 s on a busy machine.
  describe("per-email login throttle", { timeout: 15_000 }, () => {
    beforeEach(() => {
      process.env.RATE_LIMIT_DISABLED = "";
      clearAllLimits();
    });
    afterEach(() => {
      process.env.RATE_LIMIT_DISABLED = "1";
    });

    it("rejects an over-long email before touching the limiter or bcrypt", async () => {
      const verify = vi.spyOn(users, "verifyCredentials");
      const email = `${"a".repeat(300)}@example.com`;
      expect(await authorizeCredentials({ email: ` ${email} `, password: "whatever-1" })).toBeNull();
      expect(verify).not.toHaveBeenCalled();
      expect(await prisma.rateLimitCounter.count()).toBe(0);
      verify.mockRestore();
    });

    it("blocks after repeated failures, even with the right password, and a success clears the count", async () => {
      await createUser("ann@example.com", "correct-horse");
      for (let i = 0; i < 3; i++) await authorizeCredentials({ email: "ann@example.com", password: "nope-nope" });
      expect(await authorizeCredentials({ email: "ann@example.com", password: "correct-horse" })).not.toBeNull();
      for (let i = 0; i < 8; i++) await authorizeCredentials({ email: "Ann@Example.com", password: "nope-nope" });
      await expect(authorizeCredentials({ email: "ann@example.com", password: "correct-horse" })).rejects.toThrow("RateLimited");
    });

    it("counts the attempt before checking the password, so parallel guesses cannot overshoot the limit", async () => {
      const verify = vi.spyOn(users, "verifyCredentials").mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 20)); // stands in for the slow bcrypt compare
        return null;
      });
      try {
        const results = await Promise.allSettled(
          Array.from({ length: 30 }, () => authorizeCredentials({ email: "ann@example.com", password: "nope-nope" })),
        );
        expect(verify).toHaveBeenCalledTimes(8);
        expect(results.filter((r) => r.status === "rejected")).toHaveLength(22);
        expect(results.filter((r) => r.status === "fulfilled" && r.value === null)).toHaveLength(8);
      } finally {
        verify.mockRestore();
      }
    });

    it("never runs the password check for a blocked email, and a success resets the count", async () => {
      const verify = vi.spyOn(users, "verifyCredentials").mockResolvedValue(null);
      try {
        for (let i = 0; i < 8; i++) await authorizeCredentials({ email: "ann@example.com", password: "x" });
        verify.mockClear();
        await expect(authorizeCredentials({ email: "ann@example.com", password: "x" })).rejects.toThrow("RateLimited");
        expect(verify).not.toHaveBeenCalled();
        clearAllLimits();
        await prisma.rateLimitCounter.deleteMany();
        for (let i = 0; i < 7; i++) await authorizeCredentials({ email: "ann@example.com", password: "x" });
        verify.mockResolvedValue({ id: "u", email: "ann@example.com" });
        expect(await authorizeCredentials({ email: "ann@example.com", password: "ok" })).not.toBeNull();
        verify.mockResolvedValue(null);
        for (let i = 0; i < 8; i++) expect(await authorizeCredentials({ email: "ann@example.com", password: "x" })).toBeNull();
      } finally {
        verify.mockRestore();
      }
    });
  });
});
