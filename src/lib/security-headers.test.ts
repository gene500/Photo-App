import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { API_CONTENT_SECURITY_POLICY, contentSecurityPolicy, securityHeaders } from "./security-headers";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("security headers", () => {
  const csp = contentSecurityPolicy(false);

  it("allows what Mapbox GL needs", () => {
    expect(directive(csp, "worker-src")).toContain("blob:");
    expect(directive(csp, "child-src")).toContain("blob:");
    expect(directive(csp, "img-src")).toContain("data:");
    expect(directive(csp, "img-src")).toContain("blob:");
    for (const h of ["https://api.mapbox.com", "https://events.mapbox.com"]) expect(directive(csp, "connect-src")).toContain(h);
    expect(directive(csp, "style-src")).toContain("'unsafe-inline'");
  });

  it("allows the photo hosts the app uses, and nothing wildcard-wide", () => {
    const img = directive(csp, "img-src");
    for (const h of ["https://upload.wikimedia.org", "https://thumb.wikimedia.org", "https://live.staticflickr.com"]) expect(img).toContain(h);
    expect(img).not.toMatch(/ \*( |$)/);
    expect(img).not.toContain("http:");
  });

  it("forbids framing, plugins and foreign forms", () => {
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
  });

  it("only allows eval and local dev sockets in development", () => {
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("localhost");
    expect(contentSecurityPolicy(true)).toContain("'unsafe-eval'");
  });

  it("sends the standard hardening headers", () => {
    const h = Object.fromEntries(securityHeaders().map((x) => [x.key, x.value]));
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBeTruthy();
    expect(h["Permissions-Policy"]).toContain("geolocation=()");
    expect(h["Strict-Transport-Security"]).toMatch(/^max-age=\d+; includeSubDomains$/); // no preload: the app lives on a shared *.vercel.app domain
  });

  it("has no inline-script allowance: only 'self', plus a nonce and strict-dynamic when given one", () => {
    expect(directive(csp, "script-src")).toBe("script-src 'self'");
    const n = contentSecurityPolicy(false, "abc123==");
    expect(directive(n, "script-src")).toBe("script-src 'self' 'nonce-abc123==' 'strict-dynamic'");
    expect(n).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(directive(contentSecurityPolicy(true, "n"), "script-src")).toContain("'unsafe-eval'");
  });

  it("is applied by next.config: hardening headers everywhere, a locked-down CSP on /api, the page CSP left to the proxy", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    expect(all?.headers.map((x) => x.key)).not.toContain("Content-Security-Policy"); // set per request in src/proxy.ts
    expect(all?.headers.map((x) => x.key)).toContain("X-Frame-Options");
    const api = rules.find((r) => r.source === "/api/:path*");
    expect(api?.headers).toEqual([{ key: "Content-Security-Policy", value: API_CONTENT_SECURITY_POLICY }]);
    expect(rules.indexOf(all!)).toBeLessThan(rules.findIndex((r) => r.source === "/s/:path*"));
  });
});
