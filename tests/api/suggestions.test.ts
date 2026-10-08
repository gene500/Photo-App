import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/suggestions/service", () => ({ findSuggestions: vi.fn(), findSuggestionsAround: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { findSuggestions, findSuggestionsAround } from "@/server/suggestions/service";
import { OverpassError } from "@/server/suggestions/overpass";
import { POST } from "@/app/api/suggestions/route";
import { jsonRequest } from "../helpers/requests";

const body = { coordinates: [[-119.79, 36.74], [-119.12, 37.96]] };

describe("POST /api/suggestions", () => {
  beforeEach(() => vi.mocked(getCurrentUserId).mockResolvedValue("u1"));

  it("returns suggestions", async () => {
    vi.mocked(findSuggestions).mockResolvedValue([{ osmId: "node/1", name: "Spot", lat: 37, lng: -119, kind: "peak" }]);
    const res = await POST(jsonRequest("POST", "/api/suggestions", body));
    expect((await res.json()).suggestions).toHaveLength(1);
  });

  it("searches around a single point, and rejects sending both or neither", async () => {
    vi.mocked(findSuggestionsAround).mockResolvedValue([{ osmId: "node/2", name: "Near", lat: 37, lng: -119, kind: "peak" }]);
    const ok = await POST(jsonRequest("POST", "/api/suggestions", { around: [-119.79, 36.74] }));
    expect((await ok.json()).suggestions).toHaveLength(1);
    expect(findSuggestionsAround).toHaveBeenCalledWith([-119.79, 36.74]);
    expect((await POST(jsonRequest("POST", "/api/suggestions", { ...body, around: [-119, 36] }))).status).toBe(400);
    expect((await POST(jsonRequest("POST", "/api/suggestions", {}))).status).toBe(400);
    expect((await POST(jsonRequest("POST", "/api/suggestions", { around: [500, 36] }))).status).toBe(400);
  });

  it("returns 502 with a retry message when Overpass fails", async () => {
    vi.mocked(findSuggestions).mockRejectedValue(new OverpassError("timeout"));
    const res = await POST(jsonRequest("POST", "/api/suggestions", body));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't load suggestions. Please retry." });
  });

  it("requires sign-in and a valid body", async () => {
    expect((await POST(jsonRequest("POST", "/api/suggestions", { coordinates: [] }))).status).toBe(400);
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    expect((await POST(jsonRequest("POST", "/api/suggestions", body))).status).toBe(401);
  });
});
