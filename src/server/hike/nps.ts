import type { LngLat } from "@/lib/types";
import { PHOTO_USER_AGENT } from "@/server/external/photo-http";

// Fixed public ArcGIS layer, no key. Only numbers are interpolated into the query.
const LAYER = "https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails/FeatureServer/0/query";
export const NPS_TIMEOUT_MS = 6000;
export const NPS_MAX_FEATURES = 500;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPoint = (p: unknown): p is LngLat => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/**
 * Walkable trail lines from an NPS Public Trails GeoJSON answer. Lines used only by bikes, horses or vehicles, and trails
 * marked closed, are left out; unknown values are kept. Returns null when the answer is not a feature collection
 * (a broken answer is not the same as "no trails here").
 */
export function parseNpsTrails(json: unknown): LngLat[][] | null {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return null;
  const out: LngLat[][] = [];
  for (const f of features) {
    const props = ((f as { properties?: Record<string, unknown> } | null)?.properties ?? {}) as Record<string, unknown>;
    const use = typeof props.TRLUSE === "string" ? props.TRLUSE : "";
    const type = typeof props.TRLTYPE === "string" ? props.TRLTYPE : "";
    const status = typeof props.TRLSTATUS === "string" ? props.TRLSTATUS : "";
    if (use && !/hik|pedestrian|walk|all|multi/i.test(use)) continue;
    if (/road|water|snow|ski/i.test(type) || /closed/i.test(status)) continue;
    const geom = (f as { geometry?: { type?: unknown; coordinates?: unknown } } | null)?.geometry;
    const lines = geom?.type === "LineString" ? [geom.coordinates] : geom?.type === "MultiLineString" && Array.isArray(geom.coordinates) ? geom.coordinates : [];
    for (const line of lines) {
      if (!Array.isArray(line)) continue;
      const pts = line.filter(isPoint).map((p): LngLat => [p[0], p[1]]);
      if (pts.length >= 2) out.push(pts);
    }
  }
  return out;
}

/** Trail lines within `halfDeg` degrees of the point (null = the service failed). Never throws. */
export async function fetchNpsTrails(lat: number, lng: number, halfDeg: number, fetchImpl: typeof fetch = fetch): Promise<LngLat[][] | null> {
  try {
    const params = new URLSearchParams({
      f: "geojson",
      where: "1=1",
      geometry: [lng - halfDeg, lat - halfDeg, lng + halfDeg, lat + halfDeg].map((n) => n.toFixed(5)).join(","),
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      outSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "TRLNAME,TRLTYPE,TRLUSE,TRLSTATUS,UNITNAME",
      resultRecordCount: String(NPS_MAX_FEATURES),
    });
    const res = await fetchImpl(`${LAYER}?${params}`, {
      headers: { "User-Agent": PHOTO_USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(NPS_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return parseNpsTrails(await res.json());
  } catch {
    return null;
  }
}
