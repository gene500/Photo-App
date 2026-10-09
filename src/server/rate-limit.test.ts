import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearAllLimits, clientIp, enforceLimit, hit, isBlocked, POLICIES, resetLimit } from "./rate-limit";

describe("rate limiter", () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_DISABLED = "";
    clearAllLimits();
  });
  afterEach(() => {
    process.env.RATE_LIMIT_DISABLED = "1";
  });

  it("allows up to the limit then reports a Retry-After", () => {
    const t = 1_000_000;
    for (let i = 0; i < POLICIES.optimize.limit; i++) expect(hit("optimize", "u1", t).ok).toBe(true);
    const r = hit("optimize", "u1", t + 5_000);
    expect(r).toEqual({ ok: false, retryAfter: 55 });
  });

  it("keys are independent and the window resets", () => {
    const t = 5_000_000;
    for (let i = 0; i <= POLICIES.optimize.limit; i++) hit("optimize", "u1", t);
    expect(hit("optimize", "u2", t).ok).toBe(true);
    expect(hit("optimize", "u1", t + POLICIES.optimize.windowMs + 1).ok).toBe(true);
  });

  it("enforceLimit throws 429 with retryAfter", () => {
    for (let i = 0; i < POLICIES["signup-ip"].limit; i++) enforceLimit("signup-ip", "1.2.3.4");
    try {
      enforceLimit("signup-ip", "1.2.3.4");
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ status: 429, retryAfter: expect.any(Number) });
    }
  });

  it("isBlocked does not count, resetLimit clears", () => {
    const n = POLICIES["login-email-failures"].limit;
    for (let i = 0; i < n - 1; i++) hit("login-email-failures", "a@b.c");
    expect(isBlocked("login-email-failures", "a@b.c").ok).toBe(true);
    hit("login-email-failures", "a@b.c");
    expect(isBlocked("login-email-failures", "a@b.c").ok).toBe(false);
    resetLimit("login-email-failures", "a@b.c");
    expect(isBlocked("login-email-failures", "a@b.c").ok).toBe(true);
  });

  it("is a no-op when disabled outside production", () => {
    process.env.RATE_LIMIT_DISABLED = "1";
    for (let i = 0; i < 100; i++) expect(hit("signup-ip", "x").ok).toBe(true);
  });

  it("reads the client address from proxy headers", () => {
    expect(clientIp(new Headers({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" }))).toBe("9.9.9.9");
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
