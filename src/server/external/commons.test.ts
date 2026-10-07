import { describe, expect, it, vi } from "vitest";
import { getCommonsPhoto, htmlToText } from "./commons";

// Shapes captured from the live API (curl, Griffith Observatory 34.1184,-118.3004 and Half Dome 37.7459,-119.5332), trimmed.
const T = "https://thumb.wikimedia.org/wikipedia/commons/thumb";
type Opts = { mime?: string; thumb?: string; artist?: string; license?: string; cats?: string[]; lat?: string; lng?: string; descriptionurl?: string };
const file = (title: string, o: Opts = {}) => ({
  pageid: Math.floor(Math.random() * 1e8),
  ns: 6,
  title: `File:${title}`,
  index: 0,
  imagerepository: "local",
  imageinfo: [
    {
      thumburl: o.thumb ?? `${T}/e/ea/${encodeURIComponent(title)}/500px-${encodeURIComponent(title)}?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail`,
      thumbwidth: 480,
      thumbheight: 320,
      url: `https://upload.wikimedia.org/wikipedia/commons/e/ea/${encodeURIComponent(title)}`,
      descriptionurl: o.descriptionurl ?? `https://commons.wikimedia.org/wiki/File:${title.replace(/ /g, "_")}`,
      mime: o.mime ?? "image/jpeg",
      extmetadata: {
        Artist: { value: o.artist ?? '<a href="//commons.wikimedia.org/wiki/User:StefanSundin" title="User:StefanSundin">Stefan Sundin</a>', source: "commons-desc-page" },
        LicenseShortName: { value: o.license ?? "CC BY-SA 3.0", source: "commons-desc-page", hidden: "" },
        GPSLatitude: { value: o.lat ?? "34.118439", source: "commons-desc-page" },
        GPSLongitude: { value: o.lng ?? "-118.300395", source: "commons-desc-page" },
        Categories: { value: (o.cats ?? ["Griffith Observatory"]).join("|"), source: "commons-categories" },
      },
    },
  ],
  categories: (o.cats ?? ["Griffith Observatory"]).map((c) => ({ ns: 14, title: `Category:${c}` })),
});
const response = (...files: ReturnType<typeof file>[]) => ({
  batchcomplete: "",
  query: { pages: Object.fromEntries(files.map((f, i) => [String(1000 + i), f])) },
  limits: { geosearch: 15 },
});
const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body)));
const obs = { name: "Griffith Observatory", lat: 34.1184, lng: -118.3004 };

describe("getCommonsPhoto", () => {
  it("queries the Commons geosearch generator with the verified parameters and the contact User-Agent", async () => {
    const f = ok(response(file("Griffith Observatory 3.jpg")));
    await getCommonsPhoto(obs, f);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const q = new URL(url);
    expect(q.origin + q.pathname).toBe("https://commons.wikimedia.org/w/api.php");
    expect(Object.fromEntries(q.searchParams)).toMatchObject({
      action: "query", generator: "geosearch", ggsnamespace: "6", ggscoord: "34.1184|-118.3004", ggsradius: "300", ggslimit: "15",
      prop: "imageinfo|categories", iiurlwidth: "480", cllimit: "max", format: "json",
    });
    expect(q.searchParams.get("iiprop")).toContain("extmetadata");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("RoadTripPhotoPlanner/1.0 (https://photo-app-pi2o.vercel.app)");
  });

  it("builds credit from the Artist text (HTML stripped) and the short licence name", async () => {
    const photo = await getCommonsPhoto(obs, ok(response(file("Griffith Observatory 3.jpg"))));
    expect(photo).toMatchObject({
      title: "Griffith Observatory 3",
      pageUrl: "https://commons.wikimedia.org/wiki/File:Griffith_Observatory_3.jpg",
      credit: "Photo: Stefan Sundin via Wikimedia Commons (CC BY-SA 3.0)",
    });
    expect(photo?.url.startsWith("https://thumb.wikimedia.org/")).toBe(true);
  });

  it("falls back to a bare credit without artist or licence", async () => {
    const f = file("Griffith Observatory 3.jpg", { artist: "", license: "" });
    expect((await getCommonsPhoto(obs, ok(response(f))))?.credit).toBe("Photo: Wikimedia Commons");
  });

  it("prefers featured/quality/valued images, then name match, then nearest", async () => {
    const plain = file("Griffith Observatory 3.jpg", { lat: "34.1184" });
    const nearer = file("Random wall.jpg", { lat: "34.11841" });
    const quality = file("Dusk over LA.jpg", { cats: ["Quality images of Los Angeles"], lat: "34.1200" });
    expect((await getCommonsPhoto(obs, ok(response(plain, nearer, quality))))?.title).toBe("Dusk over LA");
    expect((await getCommonsPhoto(obs, ok(response(nearer, plain))))?.title).toBe("Griffith Observatory 3");
    const a = file("Wall A.jpg", { lat: "34.1190" });
    const b = file("Wall B.jpg", { lat: "34.11841" });
    expect((await getCommonsPhoto(obs, ok(response(a, b))))?.title).toBe("Wall B");
  });

  it("skips non-photo media, bad hosts and non-Commons description pages", async () => {
    const bad = [
      file("a.svg", { mime: "image/svg+xml" }),
      file("b.ogv", { mime: "video/ogg" }),
      file("c.pdf", { mime: "application/pdf" }),
      file("d.jpg", { thumb: "http://thumb.wikimedia.org/x.jpg" }),
      file("e.jpg", { thumb: "https://thumb.wikimedia.org.evil.example/x.jpg" }),
      file("f.jpg", { thumb: "https://evilupload.wikimedia.org/x.jpg" }),
      file("g.jpg", { thumb: "https://example.com/upload.wikimedia.org/x.jpg" }),
      file("h.jpg", { descriptionurl: "https://evil.example/wiki/File:h.jpg" }),
    ];
    expect(await getCommonsPhoto(obs, ok(response(...bad)))).toBeNull();
    const good = file("i.png", { mime: "image/png", thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/i.png" });
    expect((await getCommonsPhoto(obs, ok(response(...bad, good))))?.url).toBe("https://upload.wikimedia.org/wikipedia/commons/thumb/a/i.png");
  });

  it("ignores files far from the place and names that only look similar", async () => {
    const far = file("Griffith Observatory far.jpg", { lat: "34.2" });
    expect(await getCommonsPhoto(obs, ok(response(far)))).toBeNull();
    const peak = file("Eagle Rock sunset.jpg", { lat: "34.1184", cats: [] });
    // on the spot, so still the nearest photo; but it must lose to a real name match
    const named = file("Eagle Peak.jpg", { lat: "34.1190", cats: [] });
    expect((await getCommonsPhoto({ name: "Eagle Peak", lat: 34.1184, lng: -118.3004 }, ok(response(peak, named))))?.title).toBe("Eagle Peak");
  });

  it("returns null for empty, error and garbage responses", async () => {
    expect(await getCommonsPhoto(obs, ok({ batchcomplete: "" }))).toBeNull();
    expect(await getCommonsPhoto(obs, vi.fn(async () => new Response("{}", { status: 503 })))).toBeNull();
    expect(await getCommonsPhoto(obs, vi.fn(async () => new Response("<html>")))).toBeNull();
    expect(await getCommonsPhoto(obs, vi.fn().mockRejectedValue(new Error("offline")))).toBeNull();
  });
});

describe("htmlToText", () => {
  it("strips markup, decodes entities and never leaves angle brackets", () => {
    expect(htmlToText('<a href="x">Jane &amp; Co</a> <b>Doe</b>')).toBe("Jane & Co Doe");
    expect(htmlToText("<<script>script>alert(1)<</script>/script>")).not.toMatch(/[<>]/);
    expect(htmlToText("&lt;img src=x onerror=alert(1)&gt;")).not.toMatch(/[<>]/);
  });
});
