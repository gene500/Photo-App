import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { NextRequest } from "next/server";
import { clearAllLimits, POLICIES } from "@/server/rate-limit";
import { config, hasBadPercentEncoding, proxy } from "./proxy";

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
    for (const path of ["/", "/login", "/trips/abc", "/s/abc", "/offline", "/privacy", "/apiary", "/icons-guide", "/fonts-we-love"]) expect(re.test(path), path).toBe(true);
    for (const path of ["/_next/static/chunks/a.js", "/_next/image"]) expect(re.test(path), path).toBe(false);
    // The API is not buffered by the proxy: its first matcher skips it, so 401 / 413 still come from the headers alone.
    for (const path of ["/api/optimize", "/api", "/api/trips/abc/stops", "/api/stops/x/photo"]) expect(re.test(path), path).toBe(false);
  });

  it("matches API paths only when they hold a percent sign (for the bad-encoding check)", () => {
    const re = new RegExp("^/api/(.*%.*)$"); // what `/api/:rest(.*%.*)` compiles to (checked against next/dist/compiled/path-to-regexp)
    expect(config.matcher[1]).toBe("/api/:rest(.*%.*)");
    for (const path of ["/api/trips/%", "/api/trips/%E0%A4%A", "/api/x%41"]) expect(re.test(path), path).toBe(true);
    for (const path of ["/api/trips", "/api/trips/abc/stops", "/api", "/login"]) expect(re.test(path), path).toBe(false);
  });

  it("skips the public files, so only pages and share links reach the proxy", () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    const publicFiles = ["/icons/icon-192.png", "/fonts/NotoSans-Bold.ttf", "/manifest.webmanifest", "/sw.js", "/favicon.ico"];
    for (const path of publicFiles) expect(re.test(path), path).toBe(false);
    // Every file actually in /public is covered.
    const onDisk = readdirSync("public", { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => `/${relative("public", join(e.parentPath, e.name))}`);
    for (const path of onDisk.filter((p) => !p.endsWith("OFL.txt"))) expect(re.test(path), path).toBe(false);
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

describe("proxy: malformed URLs", () => {
  it("answers 400 JSON for bad percent-encoding under /api and plain 400 elsewhere", async () => {
    for (const path of ["/api/trips/%", "/api/stops/%E0%A4%A", "/api/uploads/%FF"]) {
      const res = await proxy(req(path));
      expect(res.status, path).toBe(400);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toEqual({ error: "Invalid URL" });
    }
    for (const path of ["/s/%E0%A4%A", "/trips/%E0%A4%A", "/%"]) {
      const res = await proxy(req(path));
      expect(res.status, path).toBe(400);
      expect(res.headers.get("content-type")).toContain("text/plain");
    }
  });

  it("lets well-formed encodings through, and does not add a page CSP to the API", async () => {
    expect((await proxy(req("/trips/caf%C3%A9"))).status).toBe(200);
    const api = await proxy(req("/api/trips/a%20b"));
    expect(api.status).toBe(200);
    expect(api.headers.get("content-security-policy")).toBeNull();
    expect(hasBadPercentEncoding("/a%2Fb")).toBe(false);
    expect(hasBadPercentEncoding("/a%zz")).toBe(true);
  });
});

describe("proxy: upgrade-insecure-requests", () => {
  afterEach(() => vi.unstubAllEnvs());
  const csp = async (url: string, headers: Record<string, string> = {}) =>
    (await proxy(new NextRequest(url, { headers }))).headers.get("content-security-policy") ?? "";

  it("is added in production over https only", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await csp("https://example.com/login")).toContain("upgrade-insecure-requests");
    expect(await csp("http://localhost/login", { "x-forwarded-proto": "https" })).toContain("upgrade-insecure-requests");
    expect(await csp("http://localhost/login")).not.toContain("upgrade-insecure-requests");
    vi.stubEnv("NODE_ENV", "development");
    expect(await csp("https://example.com/login")).not.toContain("upgrade-insecure-requests");
  });
});

describe("proxy: bad percent-encoding and cache headers", () => {
  it("answers 400 JSON with no-store under /api and text with no-store elsewhere", async () => {
    const api = await proxy(req("/api/trips/%"));
    expect(api.status).toBe(400);
    expect(api.headers.get("Cache-Control")).toBe("private, no-store");
    expect(api.headers.get("content-type")).toContain("application/json");
    const page = await proxy(req("/s/%E0%A4%A"));
    expect(page.status).toBe(400);
    expect(page.headers.get("Cache-Control")).toBe("private, no-store");
    expect(page.headers.get("content-type")).toContain("text/plain");
  });
  it("lets a good-encoding API path through without a CSP (the API has its own)", async () => {
    const res = await proxy(req("/api/trips/%41"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBeNull();
  });
});
