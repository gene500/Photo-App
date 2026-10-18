import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { clearAllLimits, POLICIES } from "@/server/rate-limit";
import { config, proxy } from "./proxy";

const req = (path = "/s/abc", headers: Record<string, string> = {}) => new NextRequest(`http://localhost${path}`, { headers });

describe("proxy: public share page render limit", () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_DISABLED = "";
    vi.stubEnv("TRUST_PROXY_HEADERS", "1");
    clearAllLimits();
  });
  afterEach(() => {
    process.env.RATE_LIMIT_DISABLED = "1";
    vi.unstubAllEnvs();
  });

  it("only runs on share pages", () => {
    expect(config.matcher).toEqual(["/s/:path*"]);
  });

  it("lets requests through up to the limit, then answers 429 with Retry-After, noindex and no-store", async () => {
    const h = { "x-forwarded-for": "203.0.113.5" };
    for (let i = 0; i < POLICIES["share-view"].limit; i++) expect((await proxy(req("/s/abc", h))).status).toBe(200);
    const res = await proxy(req("/s/abc", h));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    // Another address is unaffected.
    expect((await proxy(req("/s/abc", { "x-forwarded-for": "198.51.100.7" }))).status).toBe(200);
  });
});
