import { describe, expect, it, vi } from "vitest";
import { popularityRequestSchema, suggestionsRequestSchema } from "@/lib/validation";
import { getCommonsPhoto } from "../external/commons";
import { getWikipediaPhoto } from "../external/wikimedia";
import { buildCorridor, buildOverpassAroundQuery, buildOverpassQuery, toOverpassPoly } from "./corridor";

// Overpass QL is built only from numbers. These tests pin that: hostile strings never reach the builders
// (the request schema rejects them), and whatever numbers do get through produce text from a tiny alphabet.
const HOSTILE = ['"];out;node(1);out["', "}{", "1;node(around:1e9);out", '" onload="', "0\n.vp out", "1,2);out"];

describe("Overpass query building", () => {
  it("the request schema rejects non-numeric coordinates and radius", () => {
    for (const h of HOSTILE) {
      expect(suggestionsRequestSchema.safeParse({ around: [h, 10] }).success).toBe(false);
      expect(suggestionsRequestSchema.safeParse({ around: [10, h] }).success).toBe(false);
      expect(suggestionsRequestSchema.safeParse({ coordinates: [[h, 1], [2, 3]] }).success).toBe(false);
      expect(suggestionsRequestSchema.safeParse({ around: [1, 2], radiusKm: h }).success).toBe(false);
      expect(popularityRequestSchema.safeParse({ places: [{ lat: h, lng: 1 }] }).success).toBe(false);
    }
    expect(suggestionsRequestSchema.safeParse({ around: [1, 2], name: HOSTILE[0], radiusKm: 5 }).success).toBe(true); // extra keys are dropped, not used
    expect(JSON.stringify(suggestionsRequestSchema.parse({ around: [1, 2], name: HOSTILE[0] }))).not.toContain("node(1)");
  });

  it("the around query contains only digits, signs, dots and the fixed template", () => {
    const q = buildOverpassAroundQuery(-119.5332, 37.7459, 24);
    const stripped = q.replace(/\[out:json\]\[timeout:\d+\];/, "").replace(/nwr\["tourism"="viewpoint"\]|node\["natural"="peak"\]\["name"\]|nwr\["tourism"="attraction"\]/g, "").replace(/\(around:-?\d+,-?\d+\.\d+,-?\d+\.\d+\)->\.(vp|pk|at);/g, "").replace(/\.(vp|pk|at) out center \d+;/g, "").replace(/\s/g, "");
    expect(stripped).toBe("");
  });

  it("the corridor polygon is only numbers separated by spaces, and sits inside the quoted poly filter", () => {
    const poly = toOverpassPoly(buildCorridor([[-120, 36], [-119, 37]]));
    expect(poly).toMatch(/^-?\d+\.\d{5} -?\d+\.\d{5}( -?\d+\.\d{5} -?\d+\.\d{5})*$/);
    const q = buildOverpassQuery(poly);
    // Swapping the polygon for an empty one must leave exactly the fixed template: nothing else depends on input.
    expect(q.split(poly).join("")).toBe(buildOverpassQuery(""));
  });

  it("numeric extremes still render as plain decimals", () => {
    for (const [lng, lat] of [[180, 90], [-180, -90], [0, 0], [1e-9, -1e-9]] as const) {
      expect(buildOverpassAroundQuery(lng, lat, 30)).not.toMatch(/e[+-]?\d|NaN|Infinity/i);
    }
  });
});

describe("photo lookups keep user text inside encoded query parameters", () => {
  const name = 'Half "Dome" } { ]; out; & srsearch=evil #frag';

  it("Commons and Wikipedia requests only ever go to their own host, with the name encoded", async () => {
    const urls: string[] = [];
    const spy = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ query: { pages: {} } }));
    });
    await getCommonsPhoto({ name, lat: 37.7, lng: -119.5 }, spy as unknown as typeof fetch);
    await getWikipediaPhoto({ name, lat: 37.7, lng: -119.5 }, spy as unknown as typeof fetch);
    expect(spy).toHaveBeenCalled();
    for (const u of urls) {
      const parsed = new URL(u);
      expect(["commons.wikimedia.org", "en.wikipedia.org"]).toContain(parsed.host);
      expect(parsed.hash).toBe("");
    }
  });
});
