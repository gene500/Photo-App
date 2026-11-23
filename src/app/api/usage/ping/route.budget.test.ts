import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { getBudgetUsage, mapLoadState, monthEnd, monthKey } from "@/server/budget";
import { resetDb } from "../../../../../tests/helpers/db";
import { POST } from "./route";

let n = 0;
const ping = (kind: string) =>
  POST(new Request("http://localhost/api/usage/ping", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${(n += 1) % 250}` },
    body: JSON.stringify({ kind }),
  }));
const usedOf = async (product: string) => (await getBudgetUsage()).find((u) => u.product === product)!.used;
const seed = (product: string, count: number) =>
  prisma.rateLimitCounter.create({ data: { key: `budget:${product}:${monthKey(Date.now())}`, count, resetAt: monthEnd(Date.now()) } });

describe("POST /api/usage/ping against the real budget counter", () => {
  beforeEach(async () => { await resetDb(); });

  it("keeps counting map loads past the 80% cap (no 429) and reaches all-off at 95%", async () => {
    await seed("mapbox-map-load", 3999);
    expect((await ping("map-load")).status).toBe(204);
    expect(await mapLoadState()).toBe("shared-off");
    expect((await ping("map-load")).status).toBe(204);
    expect(await usedOf("mapbox-map-load")).toBe(4001);
    await prisma.rateLimitCounter.updateMany({ where: { key: { startsWith: "budget:" } }, data: { count: 4749 } });
    expect((await ping("map-load")).status).toBe(204);
    expect(await mapLoadState()).toBe("all-off");
    expect((await ping("map-load")).status).toBe(204);
    expect(await usedOf("mapbox-map-load")).toBe(4751);
  });

  it("still refuses a static-map ping at the cap", async () => {
    await seed("mapbox-static-image", 8000);
    expect((await ping("static-map")).status).toBe(429);
    expect(await usedOf("mapbox-static-image")).toBe(8000);
  });
});
