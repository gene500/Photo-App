import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/external/weather", () => ({ getForecasts: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { getForecasts } from "@/server/external/weather";
import { POST } from "./route";

const post = (body: unknown) =>
  new Request("http://localhost/api/weather/batch", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify(body) });

describe("POST /api/weather/batch", () => {
  beforeEach(() => vi.mocked(getCurrentUserId).mockResolvedValue("u1"));
  afterEach(() => vi.mocked(getForecasts).mockReset());

  it("requires sign-in", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    expect((await POST(post({ date: "2026-10-10", points: [{ lat: 1, lng: 2 }] }))).status).toBe(401);
    expect(getForecasts).not.toHaveBeenCalled();
  });
  it("returns one forecast per point", async () => {
    const f = { available: false as const, reason: "out_of_range" as const };
    vi.mocked(getForecasts).mockResolvedValue([f, f]);
    const res = await POST(post({ date: "2026-10-10", points: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }] }));
    expect(await res.json()).toEqual({ forecasts: [f, f] });
    expect(getForecasts).toHaveBeenCalledWith([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }], "2026-10-10");
  });
  it("rejects bad dates, empty and oversized batches", async () => {
    expect((await POST(post({ date: "nope", points: [{ lat: 1, lng: 2 }] }))).status).toBe(400);
    expect((await POST(post({ date: "2026-10-10", points: [] }))).status).toBe(400);
    const many = Array.from({ length: 11 }, () => ({ lat: 1, lng: 2 }));
    expect((await POST(post({ date: "2026-10-10", points: many }))).status).toBe(400);
  });
});
