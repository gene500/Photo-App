import type { Feature, FeatureCollection, LineString } from "geojson";
import type mapboxgl from "mapbox-gl";
import type { MapViewProps } from "./map-types";

export const HIKE_SOURCE = "hike-route";
export const HIKE_LAYER = "hike-route";
/** Matte, muted green for the hike's dotted line: dark enough to read on the beige map, no glow or casing. A hex because Mapbox paint cannot read CSS variables. */
export const HIKE_COLOR = "#3f6b3a";
export const HIKE_ATTRIBUTION = "Trail data © OpenStreetMap contributors, National Park Service";

export function hikeData(hikes: MapViewProps["hikes"]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: (hikes ?? []).filter((h) => h.geometry.length >= 2).map((h): Feature<LineString> => ({ type: "Feature", properties: { id: h.id }, geometry: { type: "LineString", coordinates: h.geometry } })),
  };
}

/** Adds the hike source and its dotted line if the current style does not have them (the first load, and again after a style reload wipes them). */
export function ensureHikeLayer(map: mapboxgl.Map, hikes: MapViewProps["hikes"]) {
  const source = map.getSource(HIKE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
  if (source) source.setData(hikeData(hikes));
  else map.addSource(HIKE_SOURCE, { type: "geojson", data: hikeData(hikes), attribution: HIKE_ATTRIBUTION });
  if (map.getLayer(HIKE_LAYER)) return;
  map.addLayer(
    {
      id: HIKE_LAYER,
      type: "line",
      source: HIKE_SOURCE,
      // Round caps on a near-zero dash make round dots; the gap is a multiple of the line width.
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": HIKE_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 5], "line-dasharray": [0.01, 2], "line-opacity": 0.95 },
    },
    map.getLayer("sky-sunrise") ? "sky-sunrise" : undefined,
  );
}
