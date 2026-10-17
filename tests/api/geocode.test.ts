import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/external/mapbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/external/mapbox")>()),
  searchPlaces: vi.fn(),
  retrievePlace: vi.fn(),
}));
import { getCurrentUserId } from "@/server/session";
import { ExternalServiceError, retrievePlace, searchPlaces } from "@/server/external/mapbox";
import { GET as search } from "@/app/api/geocode/route";
import { GET as retrieve } from "@/app/api/geocode/retrieve/route";
import { clearAllLimits, POLICIES } from "@/server/rate-limit";

const SESSION = "11111111-1111-4111-8111-111111111111";
const searchUrl = (qs: string) => new Request(`http://localhost/api/geocode?${qs}`);
const retrieveUrl = (qs: string) => new Request(`http://localhost/api/geocode/retrieve?${qs}`);

describe("GET /api/geocode", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(searchPlaces).mockReset();
  });

  it("returns suggestions for the query, session and proximity", async () => {
    vi.mocked(searchPlaces).mockResolvedValue([{ name: "Horseshoe Bend", subtitle: "viewpoint", mapboxId: "h1" }]);
    const res = await search(searchUrl(`q=Horseshoe&session=${SESSION}&proximity=-111.5,36.9`));
    expect(await res.json()).toEqual({ suggestions: [{ name: "Horseshoe Bend", subtitle: "viewpoint", mapboxId: "h1" }] });
    expect(searchPlaces).toHaveBeenCalledWith("Horseshoe", { proximity: { lng: -111.5, lat: 36.9 }, sessionToken: SESSION });
  });

  it("rejects a short query, a missing or malformed session and a bad proximity", async () => {
    expect((await search(searchUrl(`q=a&session=${SESSION}`))).status).toBe(400);
    expect((await search(searchUrl("q=Horseshoe"))).status).toBe(400);
    expect((await search(searchUrl("q=Horseshoe&session=not-a-uuid"))).status).toBe(400);
    expect((await search(searchUrl(`q=Horseshoe&session=${SESSION}&proximity=1,2,3`))).status).toBe(400);
    expect(searchPlaces).not.toHaveBeenCalled();
  });

  it("maps upstream failures to 502", async () => {
    vi.mocked(searchPlaces).mockRejectedValue(new ExternalServiceError("Place search failed. Please try again."));
    expect((await search(searchUrl(`q=Horseshoe&session=${SESSION}`))).status).toBe(502);
  });

  it("requires sign-in", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    expect((await search(searchUrl(`q=Horseshoe&session=${SESSION}`))).status).toBe(401);
  });
});

describe("GET /api/geocode/retrieve", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(retrievePlace).mockReset();
  });

  it("returns the place for a suggestion id", async () => {
    vi.mocked(retrievePlace).mockResolvedValue({ name: "Horseshoe Bend, Page, Arizona", lat: 36.88, lng: -111.51 });
    const res = await retrieve(retrieveUrl(`id=dXJuOm1ieHBvaTox&session=${SESSION}`));
    expect(await res.json()).toEqual({ place: { name: "Horseshoe Bend, Page, Arizona", lat: 36.88, lng: -111.51 } });
    expect(retrievePlace).toHaveBeenCalledWith("dXJuOm1ieHBvaTox", SESSION);
  });

  it("rejects a missing, overlong or unsafe id and a bad session", async () => {
    expect((await retrieve(retrieveUrl(`session=${SESSION}`))).status).toBe(400);
    expect((await retrieve(retrieveUrl(`id=${"a".repeat(301)}&session=${SESSION}`))).status).toBe(400);
    expect((await retrieve(retrieveUrl(`id=a%2F..%2Fb&session=${SESSION}`))).status).toBe(400);
    expect((await retrieve(retrieveUrl(`id=abc&session=nope`))).status).toBe(400);
    expect((await retrieve(retrieveUrl(`id=abc`))).status).toBe(400);
    expect(retrievePlace).not.toHaveBeenCalled();
  });

  it("maps upstream failures to 502", async () => {
    vi.mocked(retrievePlace).mockRejectedValue(new ExternalServiceError("Place lookup failed. Please try again."));
    expect((await retrieve(retrieveUrl(`id=abc&session=${SESSION}`))).status).toBe(502);
  });

  it("requires sign-in", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    expect((await retrieve(retrieveUrl(`id=abc&session=${SESSION}`))).status).toBe(401);
  });

  it("is rate limited per user", async () => {
    process.env.RATE_LIMIT_DISABLED = "";
    clearAllLimits();
    try {
      vi.mocked(retrievePlace).mockResolvedValue({ name: "x", lat: 1, lng: 2 });
      for (let i = 0; i < POLICIES["geocode-retrieve"].limit; i++) expect((await retrieve(retrieveUrl(`id=abc&session=${SESSION}`))).status).toBe(200);
      expect((await retrieve(retrieveUrl(`id=abc&session=${SESSION}`))).status).toBe(429);
    } finally {
      process.env.RATE_LIMIT_DISABLED = "1";
    }
  });
});
