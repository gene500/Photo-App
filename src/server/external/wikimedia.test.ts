import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlacePhoto } from "./wikimedia";

// Shapes below were captured from the live English Wikipedia API (Griffith Observatory, 34.1184,-118.3004).
const thumb = (name: string) => `https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4b/${name}/500px-${name}?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail`;
const geosearch = {
  batchcomplete: "",
  query: {
    geosearch: [
      { pageid: 645747, ns: 0, title: "Griffith Observatory", lat: 34.11833333333333, lon: -118.30033333333333, dist: 9.6, primary: "" },
      { pageid: 22660145, ns: 0, title: "Rancho Los Feliz", lat: 34.12, lon: -118.3, dist: 181.7, primary: "" },
      { pageid: 2297459, ns: 0, title: "Roosevelt Municipal Golf Course", lat: 34.118976, lon: -118.293799, dist: 611, primary: "" },
    ],
  },
};
const page = (pageid: number, title: string, source?: string) => ({
  pageid, ns: 0, title, contentmodel: "wikitext", pagelanguage: "en",
  ...(source ? { thumbnail: { source, width: 480, height: 233 } } : {}),
  fullurl: `https://en.wikipedia.org/wiki/${title.replace(/ /g, "_")}`,
});
const pageimages = (pages: ReturnType<typeof page>[]) => ({
  batchcomplete: "",
  query: { pages: Object.fromEntries(pages.map((p) => [String(p.pageid), p])) },
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function fakeFetch(geo: unknown, pages: unknown) {
  return vi.fn(async (url: string | URL | Request) => (String(url).includes("list=geosearch") ? json(geo) : json(pages)));
}

describe("getPlacePhoto", () => {
  afterEach(() => {
    delete process.env.EXTERNAL_APIS_FAKE;
  });

  const observatory = { name: "Griffith Observatory", lat: 34.1184, lng: -118.3004 };
  const allPages = pageimages([
    page(645747, "Griffith Observatory", thumb("Griffith_observatory_2006.jpg")),
    page(22660145, "Rancho Los Feliz", thumb("Feliz.jpg")),
    page(2297459, "Roosevelt Municipal Golf Course"),
  ]);

  it("picks the article whose title matches the place name", async () => {
    const fetchImpl = fakeFetch(geosearch, allPages);
    const photo = await getPlacePhoto(observatory, fetchImpl);
    expect(photo).toEqual({
      url: thumb("Griffith_observatory_2006.jpg"),
      title: "Griffith Observatory",
      pageUrl: "https://en.wikipedia.org/wiki/Griffith_Observatory",
      credit: "Wikipedia",
    });
  });

  it("sends the geosearch + pageimages requests with a descriptive User-Agent", async () => {
    const fetchImpl = fakeFetch(geosearch, allPages);
    await getPlacePhoto(observatory, fetchImpl);
    const [first, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(first).toContain("https://en.wikipedia.org/w/api.php?");
    expect(first).toContain("list=geosearch");
    expect(decodeURIComponent(first)).toContain("gscoord=34.1184|-118.3004");
    expect(first).toContain("gsradius=1500");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("RoadTripPhotoPlanner/1.0 (personal project)");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const second = decodeURIComponent(fetchImpl.mock.calls[1][0] as string);
    expect(second).toContain("prop=pageimages|info");
    expect(second).toContain("pageids=645747|22660145|2297459");
    expect(second).toContain("pithumbsize=480");
  });

  it("prefers a name match over a nearer article", async () => {
    const geo = { query: { geosearch: [{ pageid: 1, title: "Rancho Los Feliz", dist: 5 }, { pageid: 2, title: "Half Dome", dist: 900 }] } };
    const pages = pageimages([page(1, "Rancho Los Feliz", thumb("a.jpg")), page(2, "Half Dome", thumb("b.jpg"))]);
    const photo = await getPlacePhoto({ name: "Half Dome", lat: 37.7, lng: -119.5 }, fakeFetch(geo, pages));
    expect(photo?.title).toBe("Half Dome");
  });

  it("ignores generic default names and falls back to the nearest photo within 300 m", async () => {
    const photo = await getPlacePhoto({ name: "Viewpoint", lat: 34.1184, lng: -118.3004 }, fakeFetch(geosearch, allPages));
    expect(photo?.title).toBe("Griffith Observatory");
  });

  it("returns null when the only photos are too far away to be the same place", async () => {
    const geo = { query: { geosearch: [{ pageid: 2, title: "Mount Broderick", dist: 1391.1 }] } };
    const pages = pageimages([page(2, "Mount Broderick", thumb("b.jpg"))]);
    expect(await getPlacePhoto({ name: "Peak", lat: 37.7, lng: -119.5 }, fakeFetch(geo, pages))).toBeNull();
  });

  it("returns null when nothing nearby, nothing has a thumbnail, or the name matches an article without one", async () => {
    expect(await getPlacePhoto(observatory, fakeFetch({ batchcomplete: "", query: { geosearch: [] } }, {}))).toBeNull();
    const bare = pageimages([page(645747, "Griffith Observatory"), page(22660145, "Rancho Los Feliz"), page(2297459, "Roosevelt Municipal Golf Course")]);
    expect(await getPlacePhoto(observatory, fakeFetch(geosearch, bare))).toBeNull();
  });

  it("rejects thumbnails that are not https on a Wikimedia image host", async () => {
    const geo = { query: { geosearch: [{ pageid: 1, title: "Griffith Observatory", dist: 3 }] } };
    for (const bad of ["http://upload.wikimedia.org/a.jpg", "https://evil.example.com/a.jpg", "javascript:alert(1)", "https://upload.wikimedia.org.evil.com/a.jpg"]) {
      expect(await getPlacePhoto(observatory, fakeFetch(geo, pageimages([page(1, "Griffith Observatory", bad)])))).toBeNull();
    }
    const ok = await getPlacePhoto(observatory, fakeFetch(geo, pageimages([page(1, "Griffith Observatory", "https://upload.wikimedia.org/wikipedia/commons/a.jpg")])));
    expect(ok?.url).toBe("https://upload.wikimedia.org/wikipedia/commons/a.jpg");
  });

  it("falls back to a canonical article url when fullurl is missing or foreign", async () => {
    const geo = { query: { geosearch: [{ pageid: 1, title: "Half Dome", dist: 3 }] } };
    const p = { ...page(1, "Half Dome", thumb("b.jpg")), fullurl: "https://evil.example.com/x" };
    const photo = await getPlacePhoto({ name: "Half Dome", lat: 1, lng: 2 }, fakeFetch(geo, pageimages([p])));
    expect(photo?.pageUrl).toBe("https://en.wikipedia.org/wiki/Half_Dome");
  });

  it("never throws: network errors, bad statuses and garbage bodies all give null", async () => {
    expect(await getPlacePhoto(observatory, vi.fn().mockRejectedValue(new Error("offline")))).toBeNull();
    expect(await getPlacePhoto(observatory, vi.fn(async () => json({}, 500)))).toBeNull();
    expect(await getPlacePhoto(observatory, vi.fn(async () => new Response("<html>", { status: 200 })))).toBeNull();
    expect(await getPlacePhoto(observatory, vi.fn(async () => json({ error: { code: "invalid-coord" } })))).toBeNull();
  });

  it("returns an inline placeholder without touching the network in fake mode", async () => {
    process.env.EXTERNAL_APIS_FAKE = "1";
    const fetchImpl = vi.fn();
    const photo = await getPlacePhoto({ name: "Fake Peak", lat: 1, lng: 2 }, fetchImpl);
    expect(photo?.url.startsWith("data:image/svg+xml,")).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
