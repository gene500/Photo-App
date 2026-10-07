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
