import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { POST } from "@/app/api/suggestions/popularity/route";
import { jsonRequest } from "../helpers/requests";

const place = { lat: 36.7, lng: -119.7 };

describe("POST /api/suggestions/popularity", () => {
  beforeEach(() => vi.mocked(getCurrentUserId).mockResolvedValue("u1"));

  it("requires sign-in", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    expect((await POST(jsonRequest("POST", "/api/suggestions/popularity", { places: [place] }))).status).toBe(401);
  });

  it("rejects empty, oversized and out-of-range batches", async () => {
    for (const places of [[], Array(11).fill(place), [{ lat: 91, lng: 0 }], [{ lat: 0, lng: 181 }]]) {
      expect((await POST(jsonRequest("POST", "/api/suggestions/popularity", { places }))).status).toBe(400);
    }
  });

  it("returns one count (or null) per place", async () => {
    const res = await POST(jsonRequest("POST", "/api/suggestions/popularity", { places: [place, place] }));
    expect(res.status).toBe(200);
    const { counts } = await res.json();
    expect(counts).toHaveLength(2);
  });
});
