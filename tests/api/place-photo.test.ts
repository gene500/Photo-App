import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/external/place-photo", () => ({ getPlacePhoto: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { getPlacePhoto } from "@/server/external/place-photo";
import { GET } from "@/app/api/place-photo/route";

const url = (qs: string) => new Request(`http://localhost/api/place-photo?${qs}`);
const photo = { url: "https://upload.wikimedia.org/a.jpg", title: "Half Dome", pageUrl: "https://en.wikipedia.org/wiki/Half_Dome", credit: "Photo: Wikipedia" };

describe("GET /api/place-photo", () => {
  beforeEach(() => vi.mocked(getCurrentUserId).mockResolvedValue("u1"));
  afterEach(() => vi.mocked(getPlacePhoto).mockReset());

  it("returns the photo with a private day-long cache header", async () => {
    vi.mocked(getPlacePhoto).mockResolvedValue(photo);
    const res = await GET(url("lat=37.7459&lng=-119.5332&name=%20Half%20Dome%20"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(await res.json()).toEqual({ photo });
    expect(getPlacePhoto).toHaveBeenCalledWith({ name: "Half Dome", lat: 37.7459, lng: -119.5332 });
  });

  it("returns a null photo when there is none", async () => {
    vi.mocked(getPlacePhoto).mockResolvedValue(null);
    const res = await GET(url("lat=1&lng=2&name=Nowhere"));
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=900");
    expect(await res.json()).toEqual({ photo: null });
  });

  it("returns an offline placeholder in fake mode", async () => {
    process.env.EXTERNAL_APIS_FAKE = "1";
    try {
      const real = await vi.importActual<typeof import("@/server/external/place-photo")>("@/server/external/place-photo");
      vi.mocked(getPlacePhoto).mockImplementation(real.getPlacePhoto);
      const body = await (await GET(url("lat=1&lng=2&name=Fake%20Peak"))).json();
      expect(body.photo.url).toMatch(/^data:image\/svg\+xml,/);
    } finally {
      delete process.env.EXTERNAL_APIS_FAKE;
    }
  });

  it("rejects bad or missing parameters", async () => {
    expect((await GET(url("lat=95&lng=0&name=X"))).status).toBe(400);
    expect((await GET(url("lat=1&lng=2"))).status).toBe(400);
    expect((await GET(url("lat=1&lng=2&name=%20%20"))).status).toBe(400);
    expect((await GET(url(`lat=1&lng=2&name=${"x".repeat(201)}`))).status).toBe(400);
    expect((await GET(url("lat=1e2&lng=0&name=X"))).status).toBe(400);
    expect(getPlacePhoto).not.toHaveBeenCalled();
  });

  it("requires sign-in", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    expect((await GET(url("lat=1&lng=2&name=X"))).status).toBe(401);
    expect(getPlacePhoto).not.toHaveBeenCalled();
  });
});
