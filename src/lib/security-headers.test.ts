import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

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
    const h = Object.fromEntries(securityHeaders(false).map((x) => [x.key, x.value]));
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBeTruthy();
    expect(h["Permissions-Policy"]).toContain("geolocation=()");
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
  });

  it("is applied to every path by next.config, with share pages keeping no-referrer afterwards", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    expect(all?.headers.map((x) => x.key)).toContain("Content-Security-Policy");
    expect(rules.indexOf(all!)).toBeLessThan(rules.findIndex((r) => r.source === "/s/:path*"));
  });
});
