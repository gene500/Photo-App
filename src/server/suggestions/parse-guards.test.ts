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
