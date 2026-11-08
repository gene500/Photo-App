import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/photos", () => ({ retryPendingDeletions: vi.fn().mockResolvedValue({ removed: 0, failed: 0, gaveUp: 0 }) }));
vi.mock("@/server/shared-limit", () => ({ sweepSharedLimits: vi.fn() }));
vi.mock("@/server/suggestions/shared-cache", () => ({ sweepSuggestionCache: vi.fn() }));

const call = (auth?: string) => import("./route").then(({ GET }) => GET(new Request("http://localhost/api/cron/photo-cleanup", auth ? { headers: { authorization: auth } } : {})));

describe("GET /api/cron/photo-cleanup", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("answers 404 without a secret and warns once in production", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await call()).status).toBe(404);
    expect((await call()).status).toBe(404);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("CRON_SECRET");
  });

  it("does not warn outside production", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "test");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await call()).status).toBe(404);
    expect(warn).not.toHaveBeenCalled();
  });

  it("runs with the right secret and 404s with the wrong one", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect((await call("Bearer nope")).status).toBe(404);
    expect((await call("Bearer s3cret-value")).status).toBe(200);
  });
});
