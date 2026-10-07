import { afterEach, describe, expect, it } from "vitest";
import { fakeSuggestions, isFakeExternal } from "./fake";

describe("fake externals", () => {
  afterEach(() => {
    delete process.env.EXTERNAL_APIS_FAKE;
  });

  it("is enabled only by EXTERNAL_APIS_FAKE=1", () => {
    expect(isFakeExternal()).toBe(false);
    process.env.EXTERNAL_APIS_FAKE = "1";
    expect(isFakeExternal()).toBe(true);
  });

  it("returns three deterministic suggestions near the route midpoint", () => {
    const s = fakeSuggestions([[-119.8, 36.7], [-119.6, 37.0], [-119.1, 37.9]]);
    expect(s.map((x) => x.name)).toEqual(["Fake Viewpoint", "Fake Peak", "Fake Attraction"]);
    expect(s[0]).toMatchObject({ lat: 37.01, lng: -119.6, kind: "viewpoint" });
  });
});
