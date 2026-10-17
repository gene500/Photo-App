import { describe, expect, it } from "vitest";
import { parseOverpassResponse } from "./parse";

describe("parseOverpassResponse guards", () => {
  it("skips malformed elements instead of throwing", () => {
    const good = { type: "node", id: 1, lat: 37, lon: -122, tags: { tourism: "viewpoint", name: "Ok" } };
    const out = parseOverpassResponse({ elements: [null, 5, "x", { type: "node", id: 2, lat: "a", lon: 1, tags: { tourism: "viewpoint" } }, { type: "node", id: 3, lat: 1, lon: 1, tags: { tourism: "viewpoint", name: 7 } }, good] });
    expect(out.map((s) => s.osmId)).toContain("node/1");
    expect(out.find((s) => s.osmId === "node/2")).toBeUndefined();
  });
});

describe("parseOverpassResponse upstream data limits", () => {
  const vp = (id: number, lat: number, lon: number, name = "N") => ({ type: "node", id, lat, lon, tags: { tourism: "viewpoint", name } });
  it("drops elements with out-of-range or non-finite positions", () => {
    const out = parseOverpassResponse({ elements: [vp(1, 95, 0), vp(2, 0, 500), vp(3, -91, 0), vp(4, 0, -180.5), vp(5, Infinity, 0), vp(6, 10, 10)] });
    expect(out.map((s) => s.osmId)).toEqual(["node/6"]);
  });
  it("trims names to the 200 character stop limit", () => {
    const [s] = parseOverpassResponse({ elements: [vp(1, 10, 10, `  ${"x".repeat(500)}  `)] });
    expect(s.name).toHaveLength(200);
  });
});
