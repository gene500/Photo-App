import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { POST as optimize } from "@/app/api/optimize/route";
import { POST as directions } from "@/app/api/directions/route";
import { POST as suggestions } from "@/app/api/suggestions/route";
import { POST as popularity } from "@/app/api/suggestions/popularity/route";
import { GET as placePhoto } from "@/app/api/place-photo/route";
import { POST as photoPOST } from "@/app/api/stops/[id]/photo/route";
import { clearAllLimits, POLICIES } from "@/server/rate-limit";
import { idParams, jsonRequest } from "../helpers/requests";

// Bodies that fail validation (400) still count against the limit, so no upstream API is needed here.
const cases: [string, keyof typeof POLICIES, (n: number) => Promise<Response>][] = [
  ["optimize", "optimize", () => optimize(jsonRequest("POST", "/api/optimize", {}))],
  ["directions", "directions", () => directions(jsonRequest("POST", "/api/directions", {}))],
  ["suggestions", "suggestions", () => suggestions(jsonRequest("POST", "/api/suggestions", {}))],
  ["popularity", "popularity", () => popularity(jsonRequest("POST", "/api/suggestions/popularity", {}))],
  ["place-photo", "place-photo", () => placePhoto(new Request("http://localhost/api/place-photo"))],
  ["photo upload", "photo-upload", () => photoPOST(new Request("http://localhost/api/stops/x/photo", { method: "POST" }), idParams("x"))],
];

describe("per-user limits on costly routes", () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_DISABLED = "";
    clearAllLimits();
  });
  afterEach(() => {
    process.env.RATE_LIMIT_DISABLED = "1";
  });

  it.each(cases)("%s answers 429 with Retry-After once the user is over the limit", async (_n, policy, call) => {
    vi.mocked(getCurrentUserId).mockResolvedValue("user-a");
    for (let i = 0; i < POLICIES[policy].limit; i++) expect((await call(i)).status).not.toBe(429);
    const res = await call(0);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    // Another user is not affected.
    vi.mocked(getCurrentUserId).mockResolvedValue("user-b");
    expect((await call(0)).status).not.toBe(429);
  });
});
