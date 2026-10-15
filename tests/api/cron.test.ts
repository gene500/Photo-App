import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/cron/photo-cleanup/route";
import { prisma } from "@/server/db";
import { resetDb } from "../helpers/db";

const call = (auth?: string) => GET(new Request("http://localhost/api/cron/photo-cleanup", { headers: auth ? { authorization: auth } : {} }));

describe("GET /api/cron/photo-cleanup", () => {
  beforeEach(resetDb);
  afterEach(() => { delete process.env.CRON_SECRET; });

  it("answers 404 when no secret is configured", async () => {
    expect((await call("Bearer anything")).status).toBe(404);
    expect((await call()).status).toBe(404);
  });

  it("answers 404 for a missing or wrong secret and does no work", async () => {
    process.env.CRON_SECRET = "s3cret-value";
    await prisma.pendingPhotoDeletion.create({ data: { photoUrl: "/api/uploads/11111111-1111-4111-8111-111111111111.jpg" } });
    for (const h of [undefined, "Bearer wrong", "s3cret-value", "Bearer s3cret-valuX"]) expect((await call(h)).status).toBe(404);
    expect(await prisma.pendingPhotoDeletion.count()).toBe(1);
  });

  it("runs the cleanup with the right secret", async () => {
    process.env.CRON_SECRET = "s3cret-value";
    await prisma.pendingPhotoDeletion.create({ data: { photoUrl: "/api/uploads/11111111-1111-4111-8111-111111111111.jpg" } });
    const res = await call("Bearer s3cret-value");
    expect(res.status).toBe(200);
    expect((await res.json()).photos.removed).toBe(1);
    expect(await prisma.pendingPhotoDeletion.count()).toBe(0);
  });
});
