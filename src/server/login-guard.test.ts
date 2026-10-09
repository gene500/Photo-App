import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { guardAuthPost } from "./login-guard";
import { clearAllLimits, hit } from "./rate-limit";

const login = (email: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/auth/callback/credentials", {
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
});
