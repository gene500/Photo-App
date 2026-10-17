import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/suggestions/service", () => ({ findSuggestions: vi.fn(), findSuggestionsAround: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));
import { getCurrentUserId } from "@/server/session";
import { CorridorError } from "@/server/suggestions/corridor";
import { OverpassError } from "@/server/suggestions/overpass";
import { findSuggestions } from "@/server/suggestions/service";
import { POST } from "./route";

const post = (body: unknown) =>
  new Request("http://localhost/api/suggestions", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify(body) });
const route = { coordinates: [[-120, 37], [-119, 38]] };

describe("POST /api/suggestions", () => {
  beforeEach(() => vi.mocked(getCurrentUserId).mockResolvedValue("u-suggestions-route"));
  afterEach(() => vi.clearAllMocks());

  it("answers 400 with a clear message when the route cannot be turned into a corridor", async () => {
    vi.mocked(findSuggestions).mockRejectedValue(new CorridorError("Route is too complex to build a corridor for"));
    const res = await POST(post(route));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Route is too complex to search along. Try a shorter or simpler route." });
  });
  it("answers 502 when the upstream search fails", async () => {
    vi.mocked(findSuggestions).mockRejectedValue(new OverpassError("down"));
    expect((await POST(post(route))).status).toBe(502);
  });
});
