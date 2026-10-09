import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn(async () => "u1") }));

const root = path.resolve("src/app/api");
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? routeFiles(p) : n === "route.ts" ? [p] : [];
  });
}

describe("cross-site requests", () => {
  const files = routeFiles(root);

  it("finds the routes", () => expect(files.length).toBeGreaterThan(10));

  // NextAuth's route is guarded by guardAuthPost (see login-guard.test.ts) in addition to its own CSRF token.
  it.each(files.filter((f) => !f.includes("[...nextauth]")))("%s refuses every state-changing method from another origin", async (file) => {
    const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
    for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) {
      const handler = mod[method] as ((req: Request, ctx: unknown) => Promise<Response>) | undefined;
      if (!handler) continue;
      const ctx = { params: Promise.resolve({ id: "x", name: "x" }) };
      for (const headers of <Record<string, string>[]>[{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }]) {
        const res = await handler(new Request("http://localhost:3000/api/x", { method, headers, body: "{}" }), ctx);
        expect(res.status, `${method} ${file} ${JSON.stringify(headers)}`).toBe(403);
      }
    }
  });

  it("covers the auth POST route too", async () => {
    const { POST } = await import("@/app/api/auth/[...nextauth]/route");
    const res = await POST(
      new Request("http://localhost:3000/api/auth/callback/credentials", { method: "POST", headers: { origin: "https://evil.example" }, body: "x" }) as never,
      { params: Promise.resolve({ nextauth: ["callback", "credentials"] }) } as never,
    );
    expect(res.status).toBe(403);
  });
});
