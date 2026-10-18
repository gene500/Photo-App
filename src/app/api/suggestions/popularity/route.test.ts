import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/external/flickr", () => ({ flickrKey: () => "test-key", flickrBudgetLeft: async () => true, getFlickrPhotoCount: vi.fn(async () => 42) }));
vi.mock("@/server/external/wikipedia-notability", () => ({ getWikipediaNotable: vi.fn(async () => false) }));
import { getCurrentUserId } from "@/server/session";
import { getFlickrPhotoCount } from "@/server/external/flickr";
import { prisma } from "@/server/db";
import { clearAllLimits, POLICIES } from "@/server/rate-limit";
import { resetSharedCounter } from "@/server/suggestions/popularity";
import { POST } from "./route";

const post = (places: { lat: number; lng: number }[]) =>
  new Request("http://localhost/api/suggestions/popularity", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify({ places }) });

describe("POST /api/suggestions/popularity (Flickr quota)", () => {
  beforeEach(async () => {
    await prisma.rateLimitCounter.deleteMany(); // the popularity limit is counted in the shared database
    vi.stubEnv("RATE_LIMIT_DISABLED", "0");
    vi.mocked(getCurrentUserId).mockResolvedValue("u1");
    clearAllLimits();
    resetSharedCounter();
    vi.mocked(getFlickrPhotoCount).mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("spends Flickr quota once per place: repeated and overlapping requests are served from the 24 h cache", async () => {
    const places = [{ lat: 37.1, lng: -119.1 }, { lat: 37.2, lng: -119.2 }];
    expect(await (await POST(post(places))).json()).toMatchObject({ counts: [42, 42] });
    expect(getFlickrPhotoCount).toHaveBeenCalledTimes(2);
    // Same places again, in another order, plus one point within the same ~10 m cell.
    await POST(post([places[1], { lat: 37.100001, lng: -119.1 }]));
    await POST(post(places));
    expect(getFlickrPhotoCount).toHaveBeenCalledTimes(2);
    await POST(post([{ lat: 40, lng: -100 }]));
    expect(getFlickrPhotoCount).toHaveBeenCalledTimes(3);
  });

  it("limits each user per minute and answers 429 without touching Flickr", async () => {
    const limit = POLICIES.popularity.limit;
    for (let i = 0; i < limit; i++) expect((await POST(post([{ lat: 10 + i / 1000, lng: 20 }]))).status).toBe(200);
    const spent = vi.mocked(getFlickrPhotoCount).mock.calls.length;
    const res = await POST(post([{ lat: 50, lng: 50 }]));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(getFlickrPhotoCount).toHaveBeenCalledTimes(spent);
    // Another user is not affected.
    vi.mocked(getCurrentUserId).mockResolvedValue("u2");
    expect((await POST(post([{ lat: 50, lng: 50 }]))).status).toBe(200);
  });

  it("allows 10 requests per minute per user and at most 5 places per request", async () => {
    expect(POLICIES.popularity.limit).toBe(10);
    const six = Array.from({ length: 6 }, (_, i) => ({ lat: 10 + i, lng: 20 }));
    expect((await POST(post(six))).status).toBe(400);
    expect((await POST(post(six.slice(0, 5)))).status).toBe(200);
  });
});
