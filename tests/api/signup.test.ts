import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/signup/route";
import { prisma } from "@/server/db";
import { clearAllLimits } from "@/server/rate-limit";
import { issueSignupToken } from "@/server/signup-guard";
import { resetDb } from "../helpers/db";
import { jsonRequest } from "../helpers/requests";

/** A signup page load from long enough ago. */
const oldToken = () => issueSignupToken(Date.now() - 60_000);
const signup = (body: Record<string, unknown>, headers: Record<string, string> = {}) => {
  const req = jsonRequest("POST", "/api/signup", { formToken: oldToken(), ...body });
  for (const [k, v] of Object.entries(headers)) req.headers.set(k, v);
  return POST(req);
};

describe("POST /api/signup", () => {
  beforeEach(resetDb);

  it("creates an account and returns 201 without the hash", async () => {
    const res = await signup({ email: "Ann@Example.com", password: "correct-horse" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ user: { id: expect.any(String), email: "ann@example.com" } });
    expect(await prisma.user.count()).toBe(1);
  });

  it("returns 409 for a duplicate email", async () => {
    await signup({ email: "ann@example.com", password: "correct-horse" });
    const res = await signup({ email: "ann@example.com", password: "other-pass" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "An account with that email already exists" });
  });

  it("returns 400 for invalid input", async () => {
    const res = await signup({ email: "not-an-email", password: "short" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("email: Enter a valid email address");
  });

  it("silently ignores a filled honeypot without creating an account", async () => {
    const res = await signup({ email: "bot@example.com", password: "correct-horse", website: "http://spam.example" });
    expect(res.status).toBe(201);
    expect(await prisma.user.count()).toBe(0);
  });

  it("refuses a missing, forged or too-fresh form token", async () => {
    process.env.SIGNUP_MIN_SECONDS = "3";
    try {
      const body = { email: "ann@example.com", password: "correct-horse" };
      expect((await POST(jsonRequest("POST", "/api/signup", body))).status).toBe(400);
      expect((await POST(jsonRequest("POST", "/api/signup", { ...body, formToken: "123.forged" }))).status).toBe(400);
      expect((await POST(jsonRequest("POST", "/api/signup", { ...body, formToken: issueSignupToken() }))).status).toBe(400);
      expect(await prisma.user.count()).toBe(0);
      expect((await signup(body)).status).toBe(201);
    } finally {
      process.env.SIGNUP_MIN_SECONDS = "0";
    }
  });

  describe("rate limits", () => {
    beforeEach(() => {
      process.env.RATE_LIMIT_DISABLED = "";
      clearAllLimits();
    });
    afterEach(() => {
      process.env.RATE_LIMIT_DISABLED = "1";
    });

    it("answers 429 with Retry-After after too many attempts from one address", async () => {
      const ip = { "x-real-ip": "203.0.113.7" };
      for (let i = 0; i < 5; i++) expect((await signup({ email: `u${i}@example.com`, password: "correct-horse" }, ip)).status).toBe(201);
      const res = await signup({ email: "u9@example.com", password: "correct-horse" }, ip);
      expect(res.status).toBe(429);
      expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
      // Another address is unaffected.
      expect((await signup({ email: "other@example.com", password: "correct-horse" }, { "x-real-ip": "203.0.113.8" })).status).toBe(201);
    });

    it("limits repeated signups for one email across addresses", async () => {
      const body = { email: "ann@example.com", password: "correct-horse" };
      for (let i = 0; i < 3; i++) await signup(body, { "x-real-ip": `198.51.100.${i}` });
      expect((await signup(body, { "x-real-ip": "198.51.100.99" })).status).toBe(429);
    });
  });
});
