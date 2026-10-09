import { describe, expect, it } from "vitest";
import { classifyKind, parseOverpassResponse, SUGGESTION_CAP } from "./parse";

describe("classifyKind", () => {
  it("maps OSM tags to suggestion kinds", () => {
    expect(classifyKind({ tourism: "viewpoint" })).toBe("viewpoint");
    expect(classifyKind({ natural: "peak" })).toBe("peak");
    expect(classifyKind({ tourism: "attraction" })).toBe("attraction");
    expect(classifyKind({ amenity: "cafe" })).toBeNull();
  });
});

const node = (id: number, lat: number, lon: number, tags: Record<string, string>) => ({
  type: "node",
  id,
  lat,
  lon,
  tags,
});

describe("parseOverpassResponse", () => {
  it("returns [] for malformed input", () => {
    expect(parseOverpassResponse(null)).toEqual([]);
    expect(parseOverpassResponse({ elements: "nope" })).toEqual([]);
  });

  it("parses nodes and way centers into suggestions", () => {
    const result = parseOverpassResponse({
      elements: [
        node(1, 37.7156, -119.6773, { tourism: "viewpoint", name: "Tunnel View" }),
        {
          type: "way",
          id: 2,
          center: { lat: 37.73, lon: -119.57 },
          tags: { tourism: "attraction", name: "Yosemite Falls" },
        },
      ],
    });
    expect(result).toEqual([
      { osmId: "node/1", name: "Tunnel View", lat: 37.7156, lng: -119.6773, kind: "viewpoint" },
      { osmId: "way/2", name: "Yosemite Falls", lat: 37.73, lng: -119.57, kind: "attraction" },
    ]);
  });

  it("labels unnamed spots by kind and skips elements without coordinates or a known kind", () => {
    const result = parseOverpassResponse({
      elements: [
        node(1, 37, -119, { natural: "peak" }),
        { type: "way", id: 2, tags: { tourism: "viewpoint" } },
        node(3, 38, -119, { amenity: "cafe" }),
      ],
    });
    expect(result).toEqual([{ osmId: "node/1", name: "Peak", lat: 37, lng: -119, kind: "peak" }]);
  });

  it("drops repeated ids and near-duplicates, keeping the higher-ranked one", () => {
    const result = parseOverpassResponse({
      elements: [
        node(1, 37.0, -119.0, { tourism: "attraction", name: "Overlook area" }),
        node(2, 37.0002, -119.0, { tourism: "viewpoint" }), // ~22 m away, unnamed viewpoint
        node(3, 37.0003, -119.0, { tourism: "viewpoint", name: "Glacier Point" }), // ~33 m away, named
        node(3, 37.0003, -119.0, { tourism: "viewpoint", name: "Glacier Point" }), // same id again
      ],
    });
    expect(result.map((s) => s.osmId)).toEqual(["node/3"]);
  });

  it("ranks viewpoint > peak > attraction, named first, and caps the list", () => {
    const elements = [
      node(10, 37.0, -119.0, { tourism: "attraction", name: "A" }),
      node(11, 37.1, -119.0, { natural: "peak", name: "P" }),
      node(12, 37.2, -119.0, { tourism: "viewpoint" }),
      node(13, 37.3, -119.0, { tourism: "viewpoint", name: "V" }),
    ];
    expect(parseOverpassResponse({ elements }).map((s) => s.name)).toEqual(["V", "Viewpoint", "P", "A"]);
    expect(parseOverpassResponse({ elements }, 2)).toHaveLength(2);
    expect(SUGGESTION_CAP).toBe(40);
  });
});

describe("parseOverpassResponse distance ordering", () => {
  const origin = { lat: 37, lng: -119 };
  const vp = (id: number, dLng: number, name = "V") => node(id, 37, -119 + dLng, { tourism: "viewpoint", name });

  it("keeps the nearest spots when the cap bites, and lists them nearest first within a tier", () => {
    const elements = Array.from({ length: 10 }, (_, i) => vp(100 - i, (i + 1) * 0.01)); // ids descend while distance ascends
    const near = parseOverpassResponse({ elements }, 3, origin);
    expect(near.map((s) => s.osmId)).toEqual(["node/100", "node/99", "node/98"]);
    // without an origin the id decides, as before
    expect(parseOverpassResponse({ elements }, 3).map((s) => s.osmId)).toEqual(["node/100", "node/91", "node/92"]);
  });

  it("still ranks by kind tier, then named, before distance", () => {
    const result = parseOverpassResponse(
      {
        elements: [
          node(1, 37.2, -119, { tourism: "attraction", name: "Close attraction" }),
          node(2, 37, -119.5, { natural: "peak", name: "Far peak" }),
          vp(3, 0.9, "Far viewpoint"),
          node(4, 37, -119.002, { tourism: "viewpoint" }), // unnamed, very close
          vp(5, 0.3, "Nearer viewpoint"),
        ],
      },
      40,
      origin,
    );
    expect(result.map((s) => s.osmId)).toEqual(["node/5", "node/3", "node/4", "node/2", "node/1"]);
  });

  it("is deterministic for equal distances (by id)", () => {
    const result = parseOverpassResponse({ elements: [vp(9, 0.02), vp(2, -0.02)] }, 40, origin);
    expect(result.map((s) => s.osmId)).toEqual(["node/2", "node/9"]);
  });
});
