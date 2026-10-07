import { afterEach, describe, expect, it } from "vitest";
import { fakeDirections, fakeGeocode, fakeSuggestions, isFakeExternal } from "./fake";

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

describe("fakeDirections", () => {
  it("returns a straight-line route with one leg per waypoint pair", () => {
    const route = fakeDirections([[0, 0], [0, 1], [0, 2]]);
    expect(route.geometry).toEqual([[0, 0], [0, 1], [0, 2]]);
    expect(route.legs).toHaveLength(2);
    expect(route.legs[0].distance).toBeCloseTo(111_195, -1);
    expect(route.legs[0].duration).toBeCloseTo(111_195 / 25, -1);
    expect(route.distance).toBeCloseTo(2 * 111_195, -1);
  });
});

describe("fakeGeocode", () => {
  it("returns one deterministic place labelled with the query", () => {
    const [a] = fakeGeocode("Alpha Town");
    expect(a.name).toBe("Alpha Town (fake)");
    expect(fakeGeocode("Alpha Town")[0]).toEqual(a);
    expect(fakeGeocode("Beta City")[0]).not.toEqual(a);
  });
});

