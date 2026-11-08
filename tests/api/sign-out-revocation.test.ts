import { beforeEach, describe, expect, it } from "vitest";
import type { JWT } from "next-auth/jwt";
import type { Session } from "next-auth";
import { authOptions } from "@/server/auth";
import { clearRevocationCache, revokeSession } from "@/server/session-revocation";
import { clearSessionVersionCache } from "@/server/users";
import { prisma } from "@/server/db";
import { createTestUser, resetDb } from "../helpers/db";

const { jwt, session } = authOptions.callbacks!;
const signOut = authOptions.events!.signOut!;

/** A token as the jwt callback issues it at sign-in. */
async function signIn(id: string): Promise<JWT> {
  return (await jwt!({ token: {} as JWT, user: { id } } as never)) as JWT;
}
const read = async (token: JWT) =>
  (await session!({ session: { user: { email: "x" }, expires: "2099-01-01" } as Session, token } as never)) as Session;

describe("sign-out revokes only that session's token", () => {
  beforeEach(async () => {
    await resetDb();
    clearSessionVersionCache();
    clearRevocationCache();
  });

  it("gives every sign-in its own sid", async () => {
    const u = await createTestUser();
    const [a, b] = [await signIn(u.id), await signIn(u.id)];
    expect(typeof a.sid).toBe("string");
    expect(a.sid).not.toBe(b.sid);
  });

  it("accepts a token before sign-out and rejects it (and a copy) after", async () => {
    const u = await createTestUser();
    const token = await signIn(u.id);
    expect((await read(token)).user?.id).toBe(u.id);
    await signOut({ token: { ...token, exp: Math.floor(Date.now() / 1000) + 3600 } } as never);
    expect((await read(token)).user).toBeUndefined();
    // A copy of the cookie carries the same claims (it may be re-encoded with a later exp).
    expect((await read({ ...token, exp: Math.floor(Date.now() / 1000) + 7200 })).user).toBeUndefined();
  });

  it("leaves the user's other sessions and other users alone", async () => {
    const u = await createTestUser();
    const other = await createTestUser();
    const phone = await signIn(u.id);
    const laptop = await signIn(u.id);
    const theirs = await signIn(other.id);
    await signOut({ token: laptop } as never);
    expect((await read(laptop)).user).toBeUndefined();
    expect((await read(phone)).user?.id).toBe(u.id);
    expect((await read(theirs)).user?.id).toBe(other.id);
  });

  it("is seen immediately even if the token was read (and cached as valid) just before", async () => {
    const u = await createTestUser();
    const token = await signIn(u.id);
    await read(token);
    await revokeSession(token.sid as string);
    expect((await read(token)).user).toBeUndefined();
  });

  it("expires the record with the token, and the sweep removes it", async () => {
    const u = await createTestUser();
    const token = await signIn(u.id);
    await revokeSession(token.sid as string, undefined, Date.now() - 31 * 24 * 3600 * 1000);
    clearRevocationCache();
    expect((await read(token)).user?.id).toBe(u.id);
    // A copy re-rolled (jwt callback) while the record was live carries sv -1 and stays refused after the record is gone.
    const live = await signIn(u.id);
    await revokeSession(live.sid as string);
    const rerolled = (await jwt!({ token: { ...live, exp: Math.floor(Date.now() / 1000) + 99999 } } as never)) as JWT;
    expect(rerolled.sv).toBe(-1);
    await prisma.rateLimitCounter.deleteMany({ where: { key: { startsWith: "revoked-session:" } } });
    clearRevocationCache();
    expect((await read(rerolled)).user).toBeUndefined();
    const { sweepSharedLimits } = await import("@/server/shared-limit");
    await sweepSharedLimits();
    expect(await prisma.rateLimitCounter.count({ where: { key: { startsWith: "revoked-session:" } } })).toBe(0);
  });

  it("does not break tokens issued before sid existed", async () => {
    const u = await createTestUser();
    const legacy = { sub: u.id, sv: 0 } as JWT;
    expect((await read(legacy)).user?.id).toBe(u.id);
    await signOut({ token: legacy } as never);
    expect((await read(legacy)).user?.id).toBe(u.id);
  });
});
