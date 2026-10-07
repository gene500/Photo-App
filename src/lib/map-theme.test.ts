import { describe, expect, it, vi } from "vitest";
import { applyMapTheme, MAP_COLORS as C, themeLayerPaint } from "./map-theme";

const paint = (id: string, type: string) => themeLayerPaint({ id, type })?.paint;

describe("themeLayerPaint", () => {
  it("never touches our own route layers", () => {
    expect(themeLayerPaint({ id: "route-line", type: "line" })).toBeNull();
    expect(themeLayerPaint({ id: "route-casing", type: "line" })).toBeNull();
  });

  it("ignores layers it does not recognise", () => {
    expect(themeLayerPaint({ id: "mystery-layer", type: "fill" })).toBeNull();
    expect(themeLayerPaint({ id: "hillshade", type: "hillshade" })).toBeNull();
    expect(themeLayerPaint({ id: "road-oneway-arrow-blue", type: "symbol" })).toBeNull();
    expect(themeLayerPaint({ id: "road-number-shield", type: "symbol" })).toBeNull();
  });

  it("paints land, water, parks and buildings", () => {
    expect(paint("background", "background")).toEqual({ "background-color": C.land });
    expect(paint("land", "background")).toEqual({ "background-color": C.land });
    expect(paint("water", "fill")).toEqual({ "fill-color": "#dfe0da" });
    expect(paint("waterway", "line")).toEqual({ "line-color": "#dfe0da" });
    expect(paint("landuse", "fill")).toEqual({ "fill-color": "#e7e5d3" });
    expect(paint("national-park", "fill")).toEqual({ "fill-color": "#e7e5d3" });
    expect(paint("building", "fill")).toEqual({ "fill-color": "#e9e3d4" });
  });

  it("paints road fills and casings, with motorways warmer and minor casings fainter", () => {
    expect(paint("road-primary", "line")).toEqual({ "line-color": C.road });
    expect(paint("road-motorway-trunk", "line")).toEqual({ "line-color": "#f5ecd8" });
    expect(paint("road-primary-case", "line")).toEqual({ "line-color": "#e4dccb" });
    expect(paint("road-street-case", "line")).toEqual({ "line-color": C.roadCasingFaint });
    expect(paint("bridge-motorway-trunk", "line")).toEqual({ "line-color": "#f5ecd8" });
    // Casings named `bridge-case-simple` get the casing colour, not the road fill; railways stay visible.
    expect(paint("bridge-case-simple", "line")).toEqual({ "line-color": "#e4dccb" });
    expect(paint("road-rail", "line")).toEqual({ "line-color": "#e4dccb" });
    expect(paint("tunnel-street", "line")).toEqual({ "line-color": C.roadTunnel });
    expect(paint("road-path", "line")).toEqual({ "line-color": C.path });
  });

  it("draws boundaries faint and dashed", () => {
    expect(paint("admin-1-boundary", "line")).toMatchObject({ "line-color": "#d8cfbc", "line-dasharray": [2, 2] });
    expect(paint("admin-0-boundary-bg", "line")).toEqual({ "line-color": C.land });
  });

  it("colours place, road and water names", () => {
    for (const id of ["road-label", "settlement-major-label", "natural-point-label", "state-label", "country-label"]) {
      expect(paint(id, "symbol")).toEqual({ "text-color": "#7a6c52", "text-halo-color": "#f7f3ea" });
    }
    for (const id of ["water-point-label", "waterway-label"]) expect(paint(id, "symbol")?.["text-halo-color"]).toBe(C.water);
  });

  it("hides poi, transit and airport icon clutter", () => {
    for (const id of ["poi-label", "transit-label", "airport-label"]) {
      expect(themeLayerPaint({ id, type: "symbol" })).toEqual({ paint: {}, hide: true });
    }
  });
});

describe("applyMapTheme", () => {
  it("themes recognised layers, hides clutter and survives per-property failures", () => {
    const setPaintProperty = vi.fn((id: string) => {
      if (id === "water") throw new Error("boom");
    });
    const setLayoutProperty = vi.fn();
    const layers = [
      { id: "water", type: "fill" },
      { id: "route-line", type: "line" },
      { id: "poi-label", type: "symbol" },
      { id: "road-label", type: "symbol" },
    ];
    applyMapTheme({ getStyle: () => ({ layers }), setPaintProperty, setLayoutProperty });
    expect(setPaintProperty).toHaveBeenCalledWith("road-label", "text-color", "#7a6c52");
    expect(setPaintProperty.mock.calls.some(([id]) => id === "route-line")).toBe(false);
    expect(setLayoutProperty).toHaveBeenCalledWith("poi-label", "visibility", "none");
  });

  it("does nothing when the style is not available", () => {
    const setPaintProperty = vi.fn();
    expect(() => applyMapTheme({ getStyle: () => { throw new Error("not loaded"); }, setPaintProperty, setLayoutProperty: vi.fn() })).not.toThrow();
    applyMapTheme({ getStyle: () => undefined, setPaintProperty, setLayoutProperty: vi.fn() });
    expect(setPaintProperty).not.toHaveBeenCalled();
  });
});
