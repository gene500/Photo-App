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

  it("runs on pages but not on the API or build assets", () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    for (const path of ["/", "/login", "/trips/abc", "/s/abc", "/offline", "/privacy"]) expect(re.test(path), path).toBe(true);
    for (const path of ["/api/optimize", "/_next/static/chunks/a.js", "/_next/image"]) expect(re.test(path), path).toBe(false);
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

describe("proxy: Content-Security-Policy nonce", () => {
  const nonceOf = (res: Response) => /'nonce-([^']+)'/.exec(res.headers.get("content-security-policy") ?? "")?.[1];

  it("gives every page a fresh nonce in a script policy without unsafe-inline", async () => {
    const a = await proxy(req("/login"));
    const b = await proxy(req("/login"));
    expect(nonceOf(a)).toBeTruthy();
    expect(nonceOf(a)).not.toBe(nonceOf(b));
    const script = (a.headers.get("content-security-policy") ?? "").split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("unsafe-inline");
  });

  it("hands the nonce and policy to the render through the request headers", async () => {
    const res = await proxy(req("/login"));
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonceOf(res));
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(res.headers.get("content-security-policy"));
  });

  it("the share-page limit still applies alongside the nonce", async () => {
    process.env.RATE_LIMIT_DISABLED = "";
    vi.stubEnv("TRUST_PROXY_HEADERS", "1");
    clearAllLimits();
    const h = { "x-forwarded-for": "203.0.113.9" };
    for (let i = 0; i <= POLICIES["share-view"].limit; i++) await proxy(req("/s/abc", h));
    expect((await proxy(req("/s/abc", h))).status).toBe(429);
    process.env.RATE_LIMIT_DISABLED = "1";
    vi.unstubAllEnvs();
  });
});
