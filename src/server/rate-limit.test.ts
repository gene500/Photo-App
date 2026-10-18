import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

});

describe("clientIp trust modes", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  const spoof = { "x-real-ip": "6.6.6.6", "x-forwarded-for": "6.6.6.6, 7.7.7.7", "x-vercel-forwarded-for": "5.5.5.5" };
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("TRUST_PROXY_HEADERS", "");
    vi.stubEnv("TRUSTED_PROXY_DEPTH", "");
  });

  it("ignores every client address header by default (one constant key)", () => {
    expect(clientIp(h(spoof))).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "1.1.1.1" }))).toBe(clientIp(h({ "x-forwarded-for": "2.2.2.2" })));
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("warns once in production when no trusted proxy is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    clientIp(new Headers());
    clientIp(new Headers());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/TRUST_PROXY_HEADERS/);
    warn.mockRestore();
  });

  it("warns once even when the module is loaded twice (proxy and routes are separate bundles)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    delete (globalThis as Record<string, unknown>).__rtppWarnedNoProxy;
    vi.resetModules();
    const a = await import("./rate-limit");
    vi.resetModules();
    const b = await import("./rate-limit");
    a.clientIp(new Headers());
    b.clientIp(new Headers());
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("on Vercel uses x-vercel-forwarded-for, never x-real-ip or the first forwarded entry", () => {
    vi.stubEnv("VERCEL", "1");
    expect(clientIp(h(spoof))).toBe("5.5.5.5");
    expect(clientIp(h({ "x-real-ip": "6.6.6.6", "x-forwarded-for": "6.6.6.6, 7.7.7.7" }))).toBe("7.7.7.7");
    expect(clientIp(h({ "x-real-ip": "6.6.6.6" }))).toBe("unknown");
  });

  it("with TRUST_PROXY_HEADERS=1 takes the forwarded entry added by the trusted proxy (rightmost minus depth)", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "1");
    expect(clientIp(h(spoof))).toBe("7.7.7.7"); // a spoofed first entry and x-real-ip do not matter
    expect(clientIp(h({ "x-real-ip": "6.6.6.6" }))).toBe("unknown");
    vi.stubEnv("TRUSTED_PROXY_DEPTH", "2");
    expect(clientIp(h({ "x-forwarded-for": "9.9.9.9, 6.6.6.6, 7.7.7.7" }))).toBe("6.6.6.6");
    expect(clientIp(h({ "x-forwarded-for": "7.7.7.7" }))).toBe("unknown"); // fewer entries than the depth
  });

  it("only the exact value 1 enables TRUST_PROXY_HEADERS", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    expect(clientIp(h(spoof))).toBe("unknown");
  });
});

describe("IPv6 clients and map isolation", () => {
  it("collapses an IPv6 address to its /64 and unwraps IPv4-mapped ones", async () => {
    const { ipKey } = await import("./rate-limit");
    expect(ipKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(ipKey("2001:db8:1:2::1"));
    expect(ipKey("2001:db8:1:2::1")).not.toBe(ipKey("2001:db8:1:3::1"));
    expect(ipKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(ipKey("203.0.113.9")).toBe("203.0.113.9");
  });

  it("unwraps NAT64 / embedded-IPv4 forms and strips zone ids", async () => {
    const { ipKey } = await import("./rate-limit");
    expect(ipKey("64:ff9b::1.2.3.4")).toBe("1.2.3.4");
    expect(ipKey("64:ff9b::102:304")).toBe("1.2.3.4");
    expect(ipKey("::ffff:102:304")).toBe("1.2.3.4");
    expect(ipKey("::FFFF:1.2.3.4")).toBe("1.2.3.4");
    expect(ipKey("2001:db8:1:2::1.2.3.4")).toBe(ipKey("2001:db8:1:2::9"));
    expect(ipKey("fe80::1%eth0")).toBe(ipKey("fe80::1"));
    expect(ipKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });
});

describe("full policy map", () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_DISABLED = "";
    clearAllLimits();
  });
  afterEach(() => {
    process.env.RATE_LIMIT_DISABLED = "1";
  });
  const t = 9_000_000;
  const fill = (name: "login-ip" | "geocode") => {
    for (let i = 0; i < 10_000; i++) hit(name, `k${i}`, t);
  };

  it("fails closed for new keys on auth policies, with the window as retry-after", () => {
    fill("login-ip");
    expect(hit("login-ip", "newcomer", t + 1)).toEqual({ ok: false, retryAfter: POLICIES["login-ip"].windowMs / 1000 });
    expect(isBlocked("login-ip", "newcomer", t + 1).ok).toBe(false);
    expect(() => enforceLimit("login-ip", "newcomer", t + 1)).toThrow(expect.objectContaining({ status: 429 }));
    // existing keys keep their own counters
    expect(hit("login-ip", "k5", t + 1).ok).toBe(true);
    // once the window has passed the map sweeps and new keys work again
    expect(hit("login-ip", "newcomer", t + POLICIES["login-ip"].windowMs + 1).ok).toBe(true);
  });

  it("still fails open for other policies", () => {
    fill("geocode");
    expect(hit("geocode", "newcomer", t + 1).ok).toBe(true);
    expect(isBlocked("geocode", "newcomer", t + 1).ok).toBe(true);
  });
});
