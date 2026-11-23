import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./db";
import { budgetCap, clearOwnerCache, getBudgetUsage, isOwner, mapLoadState, monthEnd, monthKey, recordUsage, spendBudget, spendUserShare } from "./budget";
import { resetDb } from "../../tests/helpers/db";

const P = "mapbox-map-load" as const;
const NOV = Date.UTC(2026, 10, 15);

async function usedOf(product: string, now = Date.now()) {
  return (await getBudgetUsage(now)).find((u) => u.product === product)!.used;
}

describe("monthly API budgets", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("monthKey rolls at the UTC boundary", () => {
    expect(monthKey(Date.UTC(2026, 10, 30, 23, 59, 59))).toBe("2026-11");
    expect(monthKey(Date.UTC(2026, 11, 1, 0, 0, 0))).toBe("2026-12");
    expect(monthEnd(Date.UTC(2026, 10, 30, 23, 59, 59))).toBe(Date.UTC(2026, 11, 1));
    expect(monthEnd(Date.UTC(2026, 11, 31))).toBe(Date.UTC(2027, 0, 1));
  });

  it("cap is 80% of the allowance", () => {
    expect(budgetCap("mapbox-map-load")).toBe(4000);
    expect(budgetCap("mapbox-directions")).toBe(8000);
    expect(budgetCap("flickr")).toBeNull();
  });

  it("spends up to the cap, then refuses", async () => {
    await expect(spendBudget(P, 4000, NOV)).resolves.toBeUndefined();
    await expect(spendBudget(P, 1, NOV)).rejects.toMatchObject({ status: 429 });
  });

  it("a spend larger than the whole cap is refused and not counted", async () => {
    await expect(spendBudget(P, 4001, NOV)).rejects.toMatchObject({ status: 429 });
    expect(await usedOf(P, NOV)).toBe(0);
  });

  it("units must be a positive integer", async () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity]) await expect(spendBudget(P, bad, NOV)).rejects.toThrow(TypeError);
    expect(await usedOf(P, NOV)).toBe(0);
  });

  it("a new month starts at zero", async () => {
    await spendBudget(P, 4000, Date.UTC(2026, 10, 30));
    await expect(spendBudget(P, 1, Date.UTC(2026, 11, 1))).resolves.toBeUndefined();
  });

  it("parallel spends never pass the cap", async () => {
    const results = await Promise.allSettled(Array.from({ length: 50 }, () => spendBudget(P, 100, NOV)));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(40);
    expect(results.filter((r) => r.status === "rejected").length).toBe(10);
    expect(await usedOf(P, NOV)).toBe(4000);
  });

  it("flickr is counted but never refused", async () => {
    for (let i = 0; i < 10; i++) await spendBudget("flickr", 1, NOV);
    const row = (await getBudgetUsage(NOV)).find((u) => u.product === "flickr")!;
    expect(row.used).toBe(10);
    expect(row.cap).toBeNull();
  });

  it("recordUsage counts past the cap without refusing", async () => {
    await spendBudget(P, 4000, NOV);
    await expect(recordUsage(P, 1, NOV)).resolves.toBeUndefined();
    await recordUsage(P, 2, NOV);
    expect(await usedOf(P, NOV)).toBe(4003);
  });

  it("recordUsage answers 503 when the store throws", async () => {
    const spy = vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("down"));
    await expect(recordUsage(P, 1, NOV)).rejects.toMatchObject({ status: 503 });
    spy.mockRestore();
  });

  it("mapLoadState thresholds", async () => {
    const set = async (count: number) => {
      await prisma.rateLimitCounter.deleteMany();
      if (count > 0) await prisma.rateLimitCounter.create({ data: { key: `budget:${P}:${monthKey(NOV)}`, count, resetAt: monthEnd(NOV) } });
    };
    await set(0);
    expect(await mapLoadState(NOV)).toBe("ok");
    await set(3500);
    expect(await mapLoadState(NOV)).toBe("warn");
    await set(4000);
    expect(await mapLoadState(NOV)).toBe("shared-off");
    await set(4750);
    expect(await mapLoadState(NOV)).toBe("all-off");
  });

  describe("per-user share", () => {
    const D = "mapbox-directions" as const;
    const SHARE = 2400; // 30% of the 8000 cap
    const mk = (email: string) => prisma.user.create({ data: { email, passwordHash: "x" } });
    const saved = process.env.OWNER_EMAIL;
    beforeEach(() => {
      clearOwnerCache();
      delete process.env.OWNER_EMAIL;
    });
    afterEach(() => {
      if (saved === undefined) delete process.env.OWNER_EMAIL;
      else process.env.OWNER_EMAIL = saved;
    });

    it("refuses a user after 30% of the cap and leaves other users alone", async () => {
      const a = await mk("a@example.com");
      const b = await mk("b@example.com");
      await expect(spendUserShare(D, a.id, SHARE, NOV)).resolves.toBeUndefined();
      await expect(spendUserShare(D, a.id, 1, NOV)).rejects.toMatchObject({ status: 429, message: expect.stringContaining("your share of Mapbox directions") });
      await expect(spendUserShare(D, b.id, 1, NOV)).resolves.toBeUndefined();
    });

    it("never refuses the owner, ignoring email case", async () => {
      process.env.OWNER_EMAIL = "Owner@Example.com";
      const o = await mk("owner@example.COM");
      await expect(spendUserShare(D, o.id, SHARE, NOV)).resolves.toBeUndefined();
      await expect(spendUserShare(D, o.id, SHARE, NOV)).resolves.toBeUndefined();
      expect(await isOwner(o.id)).toBe(true);
    });

    it("exempts nobody when OWNER_EMAIL is unset or empty", async () => {
      const u = await mk("owner@example.com");
      expect(await isOwner(u.id)).toBe(false);
      process.env.OWNER_EMAIL = "";
      clearOwnerCache();
      expect(await isOwner(u.id)).toBe(false);
      await spendUserShare(D, u.id, SHARE, NOV);
      await expect(spendUserShare(D, u.id, 1, NOV)).rejects.toMatchObject({ status: 429 });
    });

    it("a different month starts at zero", async () => {
      const a = await mk("a@example.com");
      await spendUserShare(D, a.id, SHARE, Date.UTC(2026, 10, 30));
      await expect(spendUserShare(D, a.id, 1, Date.UTC(2026, 11, 1))).resolves.toBeUndefined();
    });

    it("fake externals mode never refuses and writes nothing", async () => {
      const a = await mk("a@example.com");
      process.env.EXTERNAL_APIS_FAKE = "1";
      try {
        await expect(spendUserShare(D, a.id, SHARE + 1, NOV)).resolves.toBeUndefined();
        await expect(spendUserShare(D, a.id, SHARE, NOV)).resolves.toBeUndefined();
        await expect(spendUserShare(D, a.id, SHARE, NOV)).resolves.toBeUndefined();
      } finally {
        delete process.env.EXTERNAL_APIS_FAKE;
      }
      expect(await prisma.rateLimitCounter.count({ where: { key: { startsWith: "budget-user:" } } })).toBe(0);
    });

    it("products without a cap are not limited", async () => {
      const a = await mk("a@example.com");
      await expect(spendUserShare("flickr", a.id, 100000, NOV)).resolves.toBeUndefined();
    });
  });
});
