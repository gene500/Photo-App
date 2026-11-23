import type { Feature, FeatureCollection, LineString } from "geojson";
import type mapboxgl from "mapbox-gl";
import { ACCESS_TRAIL_COLOR } from "@/lib/map-theme";
import type { TrailLine } from "@/lib/trail-lines";

export const ACCESS_TRAIL_SOURCE = "access-trail";
export const ACCESS_TRAIL_LAYER = "access-trail";

export function trailData(lines: TrailLine[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: lines.filter((l) => l.geometry.length >= 2).map((l): Feature<LineString> => ({ type: "Feature", properties: { id: l.id, mapped: l.mapped }, geometry: { type: "LineString", coordinates: l.geometry } })),
  };
}

/** Adds the road-end-to-stop trail source and its dashed line if the current style lacks them (first load, and again after a style reload). Sits under the route. */
export function ensureTrailLayer(map: mapboxgl.Map, lines: TrailLine[]) {
  const source = map.getSource(ACCESS_TRAIL_SOURCE) as mapboxgl.GeoJSONSource | undefined;
  if (source) source.setData(trailData(lines));
  else map.addSource(ACCESS_TRAIL_SOURCE, { type: "geojson", data: trailData(lines) });
  if (map.getLayer(ACCESS_TRAIL_LAYER)) return;
  map.addLayer(
    {
      id: ACCESS_TRAIL_LAYER,
      type: "line",
      source: ACCESS_TRAIL_SOURCE,
      layout: { "line-join": "round", "line-cap": "butt" },
      paint: { "line-color": ACCESS_TRAIL_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 14, 3], "line-dasharray": [2, 1.5] },
    },
    map.getLayer("route-casing") ? "route-casing" : undefined,
  );
}
