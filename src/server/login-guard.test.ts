import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { guardAuthPost, sanitizeAuthRequest } from "./login-guard";
import { clearAllLimits, hit } from "./rate-limit";

const login = (email: string, headers: Record<string, string> = {}, path = "/api/auth/callback/credentials") =>
  new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams({ email, password: "x", csrfToken: "t" }),
  });

describe("guardAuthPost", () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_DISABLED = "";
    clearAllLimits();
  });
  afterEach(() => {
    process.env.RATE_LIMIT_DISABLED = "1";
  });

  it("lets a normal login through, and does not consume the body", async () => {
    const req = login("a@b.c");
    expect(await guardAuthPost(req)).toBeNull();
    expect(await req.formData()).toBeTruthy();
  });

  it("refuses cross-site posts", async () => {
    const res = await guardAuthPost(login("a@b.c", { origin: "https://evil.example" }));
    expect(res?.status).toBe(403);
  });

  it("answers 429 + Retry-After + a RateLimited error url after too many attempts from one IP", async () => {
    const ip = { "x-real-ip": "203.0.113.50" };
    for (let i = 0; i < 30; i++) expect(await guardAuthPost(login(`u${i}@b.c`, ip))).toBeNull();
    const res = await guardAuthPost(login("late@b.c", ip));
    expect(res?.status).toBe(429);
    expect(Number(res?.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await res!.json()).url).toContain("error=RateLimited");
  });

  it("blocks an email with too many failures, whatever the IP", async () => {
    for (let i = 0; i < 8; i++) hit("login-email-failures", "victim@b.c");
    expect((await guardAuthPost(login("Victim@B.c", { "x-real-ip": "198.51.100.1" })))?.status).toBe(429);
    expect(await guardAuthPost(login("other@b.c", { "x-real-ip": "198.51.100.1" }))).toBeNull();
  });

  it("ignores other auth posts (sign-out, csrf)", async () => {
    const req = new Request("http://localhost:3000/api/auth/signout", { method: "POST", body: "x" });
    expect(await guardAuthPost(req)).toBeNull();
  });

  const variants = ["/api/auth/callback/%63redentials", "/api/auth/callback/credentials/", "/api/auth//callback/credentials", "/api/auth/callback/%2e/credentials", "/api/auth/callback/Credentials", "/api/auth/callback%2Fcredentials", "/api/auth/callback/credentials/x", "/api/auth/callback/credentials/x/y"];
  it.each(variants)(
    "throttles %s exactly like the plain path",
    async (path) => {
      const ip = { "x-real-ip": `203.0.113.${100 + variants.indexOf(path)}` };
      for (let i = 0; i < 30; i++) expect(await guardAuthPost(login(`u${i}@b.c`, ip, path))).toBeNull();
      expect((await guardAuthPost(login("late@b.c", ip, path)))?.status).toBe(429);
      expect((await guardAuthPost(login("late@b.c", ip)))?.status).toBe(429);
    },
  );

  it("applies the per-email pre-check on an encoded path", async () => {
    for (let i = 0; i < 8; i++) hit("login-email-failures", "victim@b.c");
    expect((await guardAuthPost(login("victim@b.c", {}, "/api/auth/callback/%63redentials")))?.status).toBe(429);
  });

  it("refuses an oversized body with 413 before parsing it", async () => {
    const req = new Request("http://localhost:3000/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: "a@b.c", password: "x".repeat(20_000) }),
    });
    expect((await guardAuthPost(req))?.status).toBe(413);
  });

  it("does not use an over-long email as a limiter key", async () => {
    expect(await guardAuthPost(login(`${"a".repeat(300)}@b.c`))).toBeNull();
    const { prisma } = await import("./db");
    expect(await prisma.rateLimitCounter.count({ where: { key: { contains: "aaaaaaaaaa" } } })).toBe(0);
  });
});

describe("sanitizeAuthRequest", () => {
  it("drops an unparseable callbackUrl from the query", async () => {
    const out = await sanitizeAuthRequest(new Request("http://localhost:3000/api/auth/signin?callbackUrl=http://a:b&x=1"));
    const u = new URL(out.url);
    expect(u.searchParams.has("callbackUrl")).toBe(false);
    expect(u.searchParams.get("x")).toBe("1");
  });

  it("keeps a parseable callbackUrl", async () => {
    const out = await sanitizeAuthRequest(new Request("http://localhost:3000/api/auth/signin?callbackUrl=/trips"));
    expect(new URL(out.url).searchParams.get("callbackUrl")).toBe("/trips");
  });

  it("drops an unparseable callbackUrl from a form body and keeps the other fields", async () => {
    const req = login("a@b.c");
    const body = new URLSearchParams({ email: "a@b.c", password: "x", callbackUrl: "http://localhost:3000.evil.com" });
    const out = await sanitizeAuthRequest(
      new Request(req.url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }),
    );
    const form = await out.formData();
    expect(form.has("callbackUrl")).toBe(false);
    expect(form.get("email")).toBe("a@b.c");
  });
});
