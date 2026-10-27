import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/shared-limit", () => ({ enforcePaidLimit: vi.fn() }));
vi.mock("@/server/external/mapbox", async (orig) => ({
  ...(await orig<typeof import("@/server/external/mapbox")>()),
  searchPlaces: vi.fn().mockResolvedValue([]),
  retrievePlace: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/server/external/place-photo", () => ({ getPlacePhoto: vi.fn().mockResolvedValue(null) }));
import { getCurrentUserId } from "@/server/session";
import { enforcePaidLimit } from "@/server/shared-limit";
import { GET as geocode } from "./geocode/route";
import { GET as retrieve } from "./geocode/retrieve/route";
import { GET as placePhoto } from "./place-photo/route";

const SESSION = "123e4567-e89b-42d3-a456-426614174000";

describe("paid GET routes validate before counting the limit", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(enforcePaidLimit).mockClear();
  });

  it("geocode", async () => {
    expect((await geocode(new Request(`http://localhost/api/geocode?q=a&session=${SESSION}`))).status).toBe(400);
    expect(enforcePaidLimit).not.toHaveBeenCalled();
    expect((await geocode(new Request(`http://localhost/api/geocode?q=Paris&session=${SESSION}`))).status).toBe(200);
    expect(enforcePaidLimit).toHaveBeenCalledWith("geocode", "u1");
  });

  it("geocode/retrieve", async () => {
    expect((await retrieve(new Request("http://localhost/api/geocode/retrieve?id=a%20b&session=x"))).status).toBe(400);
    expect(enforcePaidLimit).not.toHaveBeenCalled();
    expect((await retrieve(new Request(`http://localhost/api/geocode/retrieve?id=abc&session=${SESSION}`))).status).toBe(200);
    expect(enforcePaidLimit).toHaveBeenCalledWith("geocode-retrieve", "u1");
  });

  it("place-photo", async () => {
    expect((await placePhoto(new Request("http://localhost/api/place-photo?lat=1&lng=2"))).status).toBe(400);
    expect(enforcePaidLimit).not.toHaveBeenCalled();
    expect((await placePhoto(new Request("http://localhost/api/place-photo?lat=1&lng=2&name=Spot"))).status).toBe(200);
    expect(enforcePaidLimit).toHaveBeenCalledWith("place-photo", "u1");
  });
});
