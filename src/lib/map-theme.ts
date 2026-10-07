// Recolours Mapbox's stock light-v11 basemap to the beige theme at runtime (we can't publish a custom Studio style).
// Pure: maps a style layer to the paint properties to override. Anything unrecognised returns null and is left alone.

export const MAP_COLORS = {
  land: "#f2eee4",
  water: "#dfe0da",
  green: "#e7e5d3",
  greenLine: "#dad8c4",
  building: "#e9e3d4",
  buildingLine: "#ded6c3",
  road: "#fffdf8",
  roadMajor: "#f5ecd8",
  roadTunnel: "#f8f3e8",
  roadCasing: "#e4dccb",
  roadCasingFaint: "#ece5d6",
  path: "#e2dac8",
  boundary: "#d8cfbc",
  labelText: "#7a6c52",
  labelHalo: "#f7f3ea",
} as const;

export type LayerPaint = { paint: Record<string, unknown>; hide?: boolean };
type LayerInfo = { id: string; type: string };

const C = MAP_COLORS;
const has = (id: string, re: RegExp) => re.test(id);

function symbolTheme(id: string): LayerPaint | null {
  // Icon-only clutter: hidden outright (place, road and water names stay).
  if (has(id, /(^|-)(poi|transit|airport|rail-station|golf-hole)(-|$)/)) return { paint: {}, hide: true };
  if (!has(id, /label/)) return null; // shields, one-way arrows, ...: not ours to judge
  const water = has(id, /water/);
  return {
    paint: { "text-color": C.labelText, "text-halo-color": water ? C.water : C.labelHalo },
  };
}

function roadTheme(id: string, type: string): LayerPaint | null {
  if (type !== "line" && type !== "fill") return null;
  if (type === "fill") return { paint: { "fill-color": C.road } }; // pedestrian areas
  const casing = has(id, /-(case|casing)$/);
  const major = has(id, /motorway|trunk/);
  const faint = has(id, /minor|street|service|link|tertiary|secondary/);
  if (has(id, /path|pedestrian|steps|track/)) return { paint: { "line-color": C.path } };
  if (casing) return { paint: { "line-color": faint ? C.roadCasingFaint : C.roadCasing } };
  if (has(id, /^tunnel-/)) return { paint: { "line-color": major ? C.roadMajor : C.roadTunnel } };
  return { paint: { "line-color": major ? C.roadMajor : C.road } };
}

export function themeLayerPaint(layer: LayerInfo): LayerPaint | null {
  const { id, type } = layer;
  if (has(id, /^route/)) return null; // our own route layers (route-casing, route-line)

  if (type === "background") return { paint: { "background-color": C.land } };
  if (type === "symbol") return symbolTheme(id);

  if (has(id, /^(road|bridge|tunnel)-/)) return roadTheme(id, type);

  if (has(id, /admin-.*boundary/)) {
    if (type !== "line") return null;
    // The `-bg` twin is the wide soft halo under the dashes: blend it into the land.
    if (has(id, /-bg$/)) return { paint: { "line-color": C.land } };
    return { paint: { "line-color": C.boundary, "line-dasharray": [2, 2], "line-opacity": 0.8 } };
  }

  if (has(id, /^water(way)?(-shadow)?$/)) {
    if (type === "fill") return { paint: { "fill-color": C.water } };
    if (type === "line") return { paint: { "line-color": C.water } };
    return null;
  }

  if (has(id, /^building/)) {
    if (type === "fill") return { paint: { "fill-color": C.building } };
    if (type === "line") return { paint: { "line-color": C.buildingLine } };
    if (type === "fill-extrusion") return { paint: { "fill-extrusion-color": C.building } };
    return null;
  }

  if (has(id, /^(land|landcover|landuse|national-park|park|wood|grass|scrub|pitch|golf|cemetery)/) && !has(id, /structure/)) {
    const green = !has(id, /^land$/);
    if (type === "fill") return { paint: { "fill-color": green ? C.green : C.land } };
    if (type === "line") return { paint: { "line-color": green ? C.greenLine : C.land } };
    return null;
  }

  if (has(id, /^land-structure/)) {
    if (type === "fill") return { paint: { "fill-color": C.land } };
    if (type === "line") return { paint: { "line-color": C.roadCasing } };
    return null;
  }

  if (has(id, /^aeroway/)) {
    if (type === "fill") return { paint: { "fill-color": C.building } };
    if (type === "line") return { paint: { "line-color": C.roadCasing } };
    return null;
  }

  return null;
}

/** The slice of mapboxgl.Map the theme needs (keeps this module free of the mapbox import and testable). */
export type ThemableMap = {
  getStyle(): { layers?: { id: string; type: string }[] } | undefined;
  setPaintProperty(layerId: string, name: string, value: unknown): unknown;
  setLayoutProperty(layerId: string, name: string, value: unknown): unknown;
};

/**
 * Recolour every recognised layer. Each property is set in its own try/catch: a layer that lacks a property
 * (or a style that isn't ready) must never abort the loop or break the map. Safe to call repeatedly.
 */
export function applyMapTheme(map: ThemableMap): void {
  let layers: { id: string; type: string }[] = [];
  try {
    layers = map.getStyle()?.layers ?? [];
  } catch {
    return;
  }
  for (const layer of layers) {
    const themed = themeLayerPaint(layer);
    if (!themed) continue;
    for (const [name, value] of Object.entries(themed.paint)) {
      try {
        map.setPaintProperty(layer.id, name, value);
      } catch {
        /* property not valid for this layer: skip */
      }
    }
    if (themed.hide) {
      try {
        map.setLayoutProperty(layer.id, "visibility", "none");
      } catch {
        /* ignore */
      }
    }
  }
}
