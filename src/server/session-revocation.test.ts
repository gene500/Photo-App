import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./db";
import { clearRevocationCache, isSessionRevoked, revokeSession } from "./session-revocation";
import { resetDb } from "../../tests/helpers/db";

describe("session revocation", () => {
  beforeEach(async () => {
    await resetDb();
    clearRevocationCache();
  });

  it("refuses a revoked sid at once, even right after a 'not revoked' answer was cached", async () => {
    expect(await isSessionRevoked("sid-a")).toBe(false);
    await revokeSession("sid-a", Math.floor(Date.now() / 1000) + 3600);
    expect(await isSessionRevoked("sid-a")).toBe(true);
    expect(await isSessionRevoked("sid-b")).toBe(false);
  });

  it("a check that read before a revoke does not cache 'not revoked' over it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const spy = vi.spyOn(prisma.rateLimitCounter, "findUnique").mockImplementationOnce((() => gate.then(() => null)) as never);
    const pending = isSessionRevoked("sid-race"); // reads "no row", then waits
    await revokeSession("sid-race", Math.floor(Date.now() / 1000) + 3600);
    release();
    expect(await pending).toBe(false); // this request began before the revoke
    spy.mockRestore();
    expect(await isSessionRevoked("sid-race")).toBe(true); // but the next one must see it, not a stale cache entry
  });
});
