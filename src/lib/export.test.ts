// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { APPLE_MAX_STOPS_PER_LINK, appleMapsUrl, appleMapsUrls, buildGpx, googleMapsUrl, gpxFileName } from "./export";

const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `S${i}`, lat: 40 + i / 10, lng: -120 - i / 10, notes: null as string | null }));

describe("buildGpx", () => {
  it("emits a GPX 1.1 document with a wpt per stop and no timestamps", () => {
    const gpx = buildGpx({ name: "Coast", stops: [{ name: "A", lat: 1.5, lng: 2.5, notes: "dawn" }, { name: "B", lat: 3, lng: 4, notes: null }] });
    expect(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(gpx).toContain('<wpt lat="1.5" lon="2.5">');
    expect(gpx).toContain("<desc>dawn</desc>");
    expect(gpx.match(/<wpt /g)).toHaveLength(2);
    expect(gpx.match(/<desc>/g)).toHaveLength(1);
    expect(gpx).not.toContain("<trk>");
    expect(gpx).not.toContain("<time>");
  });

  it("adds a track from the route geometry as lng/lat pairs", () => {
    const gpx = buildGpx({ name: "t", stops: mk(2), route: [[-120, 40], [-121, 41]] });
    expect(gpx).toContain("<trk>");
    expect(gpx).toContain('<trkpt lat="40" lon="-120"/>');
    expect(gpx).toContain('<trkpt lat="41" lon="-121"/>');
  });

  it("escapes & < > \" ' everywhere", () => {
    const evil = `A&B <x> "q" 'z'`;
    const gpx = buildGpx({ name: evil, stops: [{ name: evil, lat: 1, lng: 2, notes: evil }] });
    expect(gpx).not.toContain("<x>");
    expect(gpx).toContain("A&amp;B &lt;x&gt; &quot;q&quot; &apos;z&apos;");
  });

  it("strips characters illegal in XML 1.0", () => {
    const gpx = buildGpx({ name: "n\u0000\u0008\u000b￾", stops: [{ name: "a\u0001b\ud800c\tz", lat: 1, lng: 2, notes: null }] });
    expect(gpx).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800￾]/);
    expect(gpx).toContain("<name>abc\tz</name>");
  });

  it("is well-formed XML", () => {
    const gpx = buildGpx({ name: "x&y", stops: mk(3), route: [[1, 2], [3, 4]] });
    const doc = new DOMParser().parseFromString(gpx, "application/xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(doc.getElementsByTagName("wpt")).toHaveLength(3);
  });
});

describe("buildGpx numbers and hostile text", () => {
  it("writes plain decimals (no exponent) and trims trailing zeros", () => {
    const gpx = buildGpx({ name: "n", stops: [{ name: "a", lat: 4e-7, lng: -1e-9, notes: null }, { name: "b", lat: 40.12345678901, lng: 100, notes: null }] });
    expect(gpx).not.toMatch(/e[-+]?\d/i);
    expect(gpx).toContain('<wpt lat="0.0000004" lon="0">');
    expect(gpx).toContain('<wpt lat="40.1234568" lon="100">');
  });

  it("skips points with non-finite coordinates", () => {
    const gpx = buildGpx({ name: "n", stops: [{ name: "bad", lat: NaN, lng: 1, notes: null }, { name: "ok", lat: 1, lng: 2, notes: null }], route: [[Infinity, 1], [3, 4]] });
    expect(gpx.match(/<wpt /g)).toHaveLength(1);
    expect(gpx.match(/<trkpt /g)).toHaveLength(1);
    expect(gpx).not.toMatch(/NaN|Infinity/);
  });

  it("round-trips hostile characters through a real XML parser", () => {
    const hostile = `A&B <script>"q" 'z' ]]> \u0000\u0007\u001f ok`;
    const gpx = buildGpx({ name: hostile, stops: [{ name: hostile, lat: 1, lng: 2, notes: hostile }], route: [[2, 1], [3, 2]] });
    const doc = new DOMParser().parseFromString(gpx, "application/xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    const expected = `A&B <script>"q" 'z' ]]>  ok`;
    expect(doc.querySelector("metadata > name")?.textContent).toBe(expected);
    expect(doc.querySelector("wpt > name")?.textContent).toBe(expected);
    expect(doc.querySelector("wpt > desc")?.textContent).toBe(expected);
    expect(doc.getElementsByTagName("script")).toHaveLength(0);
  });
});

describe("gpxFileName", () => {
  it("sanitizes the trip name", () => {
    expect(gpxFileName("Big Sur / 2026: \"best\"?")).toBe("Big-Sur-2026-best.gpx");
    expect(gpxFileName("../../etc/passwd")).toBe("etc-passwd.gpx");
    expect(gpxFileName("   ", "2026-07-01")).toBe("trip-2026-07-01.gpx");
    expect(gpxFileName("日本\u0000", "2026-07-01")).toBe("trip-2026-07-01.gpx");
    expect(gpxFileName("日本")).toMatch(/^trip-\d{4}-\d{2}-\d{2}\.gpx$/);
    expect(gpxFileName("日本 Alps", "2026-07-01")).toBe("Alps.gpx");
    expect(gpxFileName("a".repeat(200)).length).toBeLessThanOrEqual(64);
  });
});

describe("googleMapsUrl", () => {
  it("returns null under 2 stops", () => {
    expect(googleMapsUrl(mk(0))).toBeNull();
    expect(googleMapsUrl(mk(1))).toBeNull();
  });
  it("2 stops: origin and destination only", () => {
    const r = googleMapsUrl(mk(2))!;
    expect(r).toHaveLength(1);
    const u = new URL(r[0].url);
    expect(u.origin + u.pathname).toBe("https://www.google.com/maps/dir/");
    expect(u.searchParams.get("api")).toBe("1");
    expect(u.searchParams.get("origin")).toBe("40,-120");
    expect(u.searchParams.get("destination")).toBe("40.1,-120.1");
    expect(u.searchParams.has("waypoints")).toBe(false);
  });
  it("5 stops: 3 waypoints joined by |", () => {
    const r = googleMapsUrl(mk(5))!;
    expect(r).toHaveLength(1);
    expect(new URL(r[0].url).searchParams.get("waypoints")).toBe("40.1,-120.1|40.2,-120.2|40.3,-120.3");
    expect(r[0].url).toContain("%7C");
  });
  it("12 stops: chunked into linked parts with at most 9 waypoints each", () => {
    const r = googleMapsUrl(mk(12))!;
    expect(r.map((p) => p.label)).toEqual(["Part 1/2", "Part 2/2"]);
    const p1 = new URL(r[0].url).searchParams, p2 = new URL(r[1].url).searchParams;
    expect(p1.get("waypoints")!.split("|")).toHaveLength(9);
    expect(p1.get("origin")).toBe("40,-120");
    expect(p1.get("destination")).toBe("41,-121"); // stop index 10
    expect(p2.get("origin")).toBe("41,-121");
    expect(p2.get("destination")).toBe("41.1,-121.1");
    expect(p2.has("waypoints")).toBe(false);
  });
  it("11 stops fit one link (9 waypoints); 12 and 22 split into linked parts", () => {
    expect(googleMapsUrl(mk(11))).toHaveLength(1);
    expect(new URL(googleMapsUrl(mk(11))![0].url).searchParams.get("waypoints")!.split("|")).toHaveLength(9);
    const r22 = googleMapsUrl(mk(22))!;
    expect(r22).toHaveLength(3); // stops 0-10, 10-20, 20-21
    const origins = r22.map((p) => new URL(p.url).searchParams);
    expect(origins[1].get("origin")).toBe(origins[0].get("destination"));
    expect(origins[2].get("origin")).toBe(origins[1].get("destination"));
    expect(origins[2].get("destination")).toBe("42.1,-122.1"); // the last stop
    for (const q of origins) expect((q.get("waypoints") ?? "").split("|").filter(Boolean).length).toBeLessThanOrEqual(9);
  });
  it("single link has no part label", () => {
    expect(googleMapsUrl(mk(11))![0].label).toBe("");
  });
});

describe("appleMapsUrl", () => {
  it("returns null under 2 stops", () => {
    expect(appleMapsUrl(mk(1))).toBeNull();
  });
  it("builds saddr and daddr with +to: chaining", () => {
    const u = new URL(appleMapsUrl(mk(2))!);
    expect(u.origin).toBe("https://maps.apple.com");
    expect(u.searchParams.get("saddr")).toBe("40,-120");
    expect(u.searchParams.get("daddr")).toBe("40.1,-120.1");
    const five = new URL(appleMapsUrl(mk(5))!);
    expect(five.searchParams.get("daddr")).toBe("40.1,-120.1 to:40.2,-120.2 to:40.3,-120.3 to:40.4,-120.4");
    expect(appleMapsUrl(mk(5))).toContain("+to%3A");
  });
  it("12 stops all fit in one link", () => {
    expect(new URL(appleMapsUrl(mk(12))!).searchParams.get("daddr")!.split(" to:")).toHaveLength(11);
  });
});

describe("appleMapsUrls", () => {
  it("returns null under 2 stops, and one unlabelled link up to the cap", () => {
    expect(appleMapsUrls(mk(1))).toBeNull();
    const one = appleMapsUrls(mk(APPLE_MAX_STOPS_PER_LINK))!;
    expect(one).toHaveLength(1);
    expect(one[0]!.label).toBe("");
  });
  it("splits longer trips into linked parts that share an end point, each within the cap", () => {
    const stops = mk(45);
    const links = appleMapsUrls(stops)!;
    expect(links.map((l) => l.label)).toEqual(["Part 1/3", "Part 2/3", "Part 3/3"]);
    let previousEnd: string | null = null;
    for (const l of links) {
      const u = new URL(l.url);
      const points = [u.searchParams.get("saddr")!, ...u.searchParams.get("daddr")!.split(" to:")];
      expect(points.length).toBeLessThanOrEqual(APPLE_MAX_STOPS_PER_LINK);
      if (previousEnd) expect(points[0]).toBe(previousEnd);
      previousEnd = points[points.length - 1]!;
      expect(l.url.length).toBeLessThan(1000);
    }
    expect(previousEnd).toBe("44.4,-124.4");
  });
});
