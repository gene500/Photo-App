import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFlickrPhoto, getFlickrPhotoCount } from "./flickr";

// Fixtures follow the response shape documented at flickr.com/services/api/flickr.photos.search.html (format=json&nojsoncallback=1);
// there was no API key to capture a live response, so Flickr is verified against docs/fixtures only.
const photo = (o: Record<string, unknown> = {}) => ({
  id: "53456789012", owner: "12345678@N00", secret: "abcdef0123", server: "65535", farm: 66, title: "Griffith Observatory at dusk",
  ispublic: 1, isfriend: 0, isfamily: 0, license: "4", ownername: "Jane Doe", url_m: "https://live.staticflickr.com/65535/53456789012_abcdef0123.jpg",
  height_m: 333, width_m: 500, ...o,
});
const search = (photos: unknown[], total = "6170") => ({ photos: { page: 1, pages: 1234, perpage: 5, total, photo: photos }, stat: "ok" });
const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body)));
const obs = { name: "Griffith Observatory", lat: 34.1184, lng: -118.3004 };

describe("Flickr", () => {
  beforeEach(() => {
    process.env.FLICKR_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.FLICKR_API_KEY;
  });

  it("is skipped silently without a key (no request at all)", async () => {
    delete process.env.FLICKR_API_KEY;
    const f = ok(search([photo()]));
    expect(await getFlickrPhoto(obs, f)).toBeNull();
    expect(await getFlickrPhotoCount(obs, f)).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });

  it("sends the documented photos.search parameters and the contact User-Agent", async () => {
    const f = ok(search([photo()]));
    await getFlickrPhoto(obs, f);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const q = new URL(url);
    expect(q.origin + q.pathname).toBe("https://api.flickr.com/services/rest/");
    expect(Object.fromEntries(q.searchParams)).toMatchObject({
      method: "flickr.photos.search", api_key: "test-key", lat: "34.1184", lon: "-118.3004", radius: "0.3", radius_units: "km",
      license: "1,2,3,4,5,6,9,10", sort: "interestingness-desc", per_page: "5", has_geo: "1", content_types: "0", media: "photos",
      extras: "url_m,owner_name,license", format: "json", nojsoncallback: "1",
    });
    expect(Number(q.searchParams.get("min_upload_date"))).toBeGreaterThan(0);
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("RoadTripPhotoPlanner/1.0 (https://photo-app-pi2o.vercel.app)");
  });

  it("returns the first photo with credit, licence and page url", async () => {
    expect(await getFlickrPhoto(obs, ok(search([photo()])))).toEqual({
      url: "https://live.staticflickr.com/65535/53456789012_abcdef0123.jpg",
      title: "Griffith Observatory at dusk",
      pageUrl: "https://www.flickr.com/photos/12345678@N00/53456789012",
      credit: "Photo: Jane Doe via Flickr (CC BY 2.0)",
    });
    expect((await getFlickrPhoto(obs, ok(search([photo({ license: "9" })]))))?.credit).toBe("Photo: Jane Doe via Flickr (CC0)");
  });

  it("only accepts https images on staticflickr.com hosts and rejects lookalikes", async () => {
    const bad = [
      "http://live.staticflickr.com/a.jpg",
      "https://staticflickr.com.evil.example/a.jpg",
      "https://evilstaticflickr.com/a.jpg",
      "https://live.staticflickr.com@evil.example/a.jpg",
      "https://evil.example/live.staticflickr.com/a.jpg",
      "https://live.staticflickr.com:8443/a.jpg",
      "javascript:alert(1)",
      undefined,
    ];
    expect(await getFlickrPhoto(obs, ok(search(bad.map((u) => photo({ url_m: u })))))).toBeNull();
    const good = photo({ id: "2", url_m: "https://farm5.staticflickr.com/1/2_x.jpg" });
    expect((await getFlickrPhoto(obs, ok(search([...bad.map((u) => photo({ url_m: u })), good]))))?.url).toBe("https://farm5.staticflickr.com/1/2_x.jpg");
  });

  it("skips photos with an unknown licence or a suspicious owner/id", async () => {
    const list = [photo({ license: "0" }), photo({ license: "7" }), photo({ owner: "x/../y" }), photo({ id: "12/3" })];
    expect(await getFlickrPhoto(obs, ok(search(list)))).toBeNull();
  });

  it("prefers a photo whose title names the place over the most interesting one", async () => {
    const list = [photo({ id: "1", title: "Sunset" }), photo({ id: "2", title: "Griffith Observatory" })];
    expect((await getFlickrPhoto(obs, ok(search(list))))?.pageUrl).toMatch(/\/2$/);
  });

  it("treats stat != ok, HTTP errors, garbage and network failures as no photo", async () => {
    expect(await getFlickrPhoto(obs, ok({ stat: "fail", code: 100, message: "Invalid API Key (Key has invalid format)" }))).toBeNull();
    expect(await getFlickrPhoto(obs, vi.fn(async () => new Response("{}", { status: 500 })))).toBeNull();
    expect(await getFlickrPhoto(obs, vi.fn(async () => new Response("nope")))).toBeNull();
    expect(await getFlickrPhoto(obs, vi.fn().mockRejectedValue(new Error("offline")))).toBeNull();
    expect(await getFlickrPhoto(obs, ok({ stat: "ok", photos: {} }))).toBeNull();
  });

  it("counts photos within 250 m from photos.total (string or number), undefined on failure", async () => {
    const f = ok(search([photo()], "6170"));
    expect(await getFlickrPhotoCount(obs, f)).toBe(6170);
    const q = new URL((f.mock.calls[0] as unknown as [string])[0]);
    expect(q.searchParams.get("radius")).toBe("0.25");
    expect(q.searchParams.get("per_page")).toBe("1");
    expect(await getFlickrPhotoCount(obs, ok({ stat: "ok", photos: { total: 42, photo: [] } }))).toBe(42);
    expect(await getFlickrPhotoCount(obs, ok({ stat: "fail" }))).toBeUndefined();
    expect(await getFlickrPhotoCount(obs, ok({ stat: "ok", photos: { total: "abc" } }))).toBeUndefined();
    expect(await getFlickrPhotoCount(obs, vi.fn().mockRejectedValue(new Error("x")))).toBeUndefined();
  });
});
