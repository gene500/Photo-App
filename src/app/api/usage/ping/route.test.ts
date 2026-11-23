import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/budget", () => ({ spendBudget: vi.fn(), recordUsage: vi.fn() }));
import { recordUsage, spendBudget } from "@/server/budget";
import { HttpError } from "@/server/http";
import { POST } from "./route";

let n = 0;
const ping = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost/api/usage/ping", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${n}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));

describe("POST /api/usage/ping", () => {
  beforeEach(() => { vi.clearAllMocks(); n += 1; });
  afterEach(() => vi.unstubAllEnvs());

  it("spends one map-load unit and answers 204 without a sign-in", async () => {
    const res = await ping({ kind: "map-load" });
    expect(res.status).toBe(204);
    expect(recordUsage).toHaveBeenCalledWith("mapbox-map-load", 1);
    expect(spendBudget).not.toHaveBeenCalled();
  });

  it("spends one static image unit for a static-map ping", async () => {
    expect((await ping({ kind: "static-map" })).status).toBe(204);
    expect(spendBudget).toHaveBeenCalledWith("mapbox-static-image", 1);
  });

  it("rejects an unknown or missing kind and bad JSON with 400, spending nothing", async () => {
    expect((await ping({ kind: "geocode" })).status).toBe(400);
    expect((await ping({})).status).toBe(400);
    expect((await ping("not json")).status).toBe(400);
    expect(spendBudget).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin post", async () => {
    expect((await ping({ kind: "map-load" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await ping({ kind: "map-load" }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(spendBudget).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it("passes a budget refusal on as 429", async () => {
    vi.mocked(spendBudget).mockRejectedValueOnce(new HttpError(429, "Monthly limit reached"));
    expect((await ping({ kind: "static-map" })).status).toBe(429);
  });

  it("refuses the 31st ping in a minute from one address", async () => {
    vi.stubEnv("RATE_LIMIT_DISABLED", "0");
    // A random address per run, so a re-run within the minute cannot start from a used counter.
    const ip = `198.51.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`;
    const from = (body: unknown) => ping(body, { "x-forwarded-for": ip });
    for (let i = 0; i < 30; i++) expect((await from({ kind: "map-load" })).status).toBe(204);
    expect((await from({ kind: "map-load" })).status).toBe(429);
    // Another address is unaffected.
    n += 1;
    expect((await ping({ kind: "map-load" })).status).toBe(204);
  });
});
