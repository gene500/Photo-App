import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./db";
import { clearAllLimits, POLICIES } from "./rate-limit";
import { enforcePaidLimit, hitShared, isBlockedShared, resetShared, sweepSharedLimits } from "./shared-limit";
import { resetDb } from "../../tests/helpers/db";

describe("shared (database) rate limits", () => {
  beforeEach(async () => {
    process.env.RATE_LIMIT_DISABLED = "";
    clearAllLimits();
    await resetDb();
  });
  afterEach(() => {
    process.env.RATE_LIMIT_DISABLED = "1";
  });

  it("allows up to the limit, then refuses with a retry time", async () => {
    const { limit } = POLICIES["signup-email"];
    for (let i = 0; i < limit; i++) expect((await hitShared("signup-email", "a@example.com")).ok).toBe(true);
    const over = await hitShared("signup-email", "a@example.com");
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.retryAfter).toBeGreaterThan(0);
  });

  it("holds across instances: another instance with empty memory still sees the count", async () => {
    const { limit } = POLICIES["login-email-failures"];
    for (let i = 0; i < limit; i++) await hitShared("login-email-failures", "v@example.com");
    clearAllLimits(); // a different server instance has no in-memory counters
    expect((await isBlockedShared("login-email-failures", "v@example.com")).ok).toBe(false);
    expect((await hitShared("login-email-failures", "v@example.com")).ok).toBe(false);
  });

  it("starts a fresh window once the old one ends", async () => {
    const t0 = 1_000_000;
    const { limit, windowMs } = POLICIES["signup-ip"];
    for (let i = 0; i < limit + 1; i++) await hitShared("signup-ip", "1.2.3.4", t0);
    clearAllLimits();
    expect((await hitShared("signup-ip", "1.2.3.4", t0 + windowMs + 1)).ok).toBe(true);
  });

  it("counts concurrent hits exactly", async () => {
    const { limit } = POLICIES["account-delete"];
    const results = await Promise.all(Array.from({ length: limit + 3 }, () => hitShared("account-delete", "u1")));
    expect(results.filter((r) => r.ok).length).toBe(limit);
  });

  it("reset clears the shared counter too", async () => {
    const { limit } = POLICIES["login-email-failures"];
    for (let i = 0; i < limit; i++) await hitShared("login-email-failures", "r@example.com");
    await resetShared("login-email-failures", "r@example.com");
    clearAllLimits();
    expect((await isBlockedShared("login-email-failures", "r@example.com")).ok).toBe(true);
  });

  it("keys do not collide across policies or keys", async () => {
    const { limit } = POLICIES["signup-ip"];
    for (let i = 0; i < limit + 1; i++) await hitShared("signup-ip", "9.9.9.9");
    expect((await hitShared("signup-ip", "8.8.8.8")).ok).toBe(true);
    expect((await hitShared("login-ip", "9.9.9.9")).ok).toBe(true);
  });

  it("falls back to the in-memory answer when the database fails", async () => {
    const spy = vi.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error("db down"));
    expect((await hitShared("login-ip", "7.7.7.7")).ok).toBe(true);
    spy.mockRestore();
  });

  it("sweeps expired counters only", async () => {
    await prisma.rateLimitCounter.createMany({ data: [{ key: "old", count: 1, resetAt: 10 }, { key: "live", count: 1, resetAt: 9_999_999_999_999 }] });
    await sweepSharedLimits(1000);
    expect((await prisma.rateLimitCounter.findMany()).map((r) => r.key)).toEqual(["live"]);
  });

  it("hitShared with failClosed refuses when the database fails", async () => {
    const spy = vi.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error("db down"));
    const r = await hitShared("geocode", "u", Date.now(), { failClosed: true });
    spy.mockRestore();
    expect(r.ok).toBe(false);
    if (!r.ok) expect("unavailable" in r).toBe(true);
  });

  it("enforcePaidLimit throws 429 over the limit and 503 when the database is down", async () => {
    for (let i = 0; i < POLICIES.geocode.limit; i++) await enforcePaidLimit("geocode", "p1");
    await expect(enforcePaidLimit("geocode", "p1")).rejects.toMatchObject({ status: 429 });
    const spy = vi.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error("db down"));
    await expect(enforcePaidLimit("geocode", "p2")).rejects.toMatchObject({ status: 503, retryAfter: expect.any(Number) });
    spy.mockRestore();
  });
});
