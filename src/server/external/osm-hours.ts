import { haversineMeters } from "@/lib/geo";
import { PHOTO_USER_AGENT } from "./photo-http";

// One small Overpass query for all stops of an Optimize run, cached for a day. Public servers are for light use only:
// https://wiki.openstreetmap.org/wiki/Overpass_API (identify the app, cache, back off 30 s after a 429).
const DEFAULT_URL = "https://overpass-api.de/api/interpreter";
export const OSM_HOURS_TIMEOUT_MS = 6000;
export const OSM_HOURS_TTL_MS = 24 * 60 * 60_000;
export const OSM_FAILURE_TTL_MS = 5 * 60_000;
export const OSM_BACKOFF_MS = 30_000;
export const OSM_MATCH_RADIUS_M = 40;
export const OSM_MAX_STOPS = 15;
const MAX_RESULTS = 400;

type Point = { lat: number; lng: number };
export const osmHoursKey = (p: Point) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;

export function buildHoursQuery(points: Point[]): string {
  const parts = points.map((p) => `nwr(around:${OSM_MATCH_RADIUS_M},${p.lat.toFixed(5)},${p.lng.toFixed(5)})["opening_hours"];`);
  return `[out:json][timeout:5];(${parts.join("")});out tags center ${MAX_RESULTS};`;
}

type Element = { lat: number; lng: number; hours: string };

export function parseHoursElements(json: unknown): Element[] {
  const els = (json as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(els)) return [];
  return els.flatMap((e): Element[] => {
    if (typeof e !== "object" || e === null) return [];
    const r = e as { lat?: unknown; lon?: unknown; center?: { lat?: unknown; lon?: unknown }; tags?: { opening_hours?: unknown } };
    const lat = Number(r.lat ?? r.center?.lat);
    const lng = Number(r.lon ?? r.center?.lon);
    const hours = r.tags?.opening_hours;
    return Number.isFinite(lat) && Number.isFinite(lng) && typeof hours === "string" ? [{ lat, lng, hours }] : [];
  });
}

export function createOsmHoursClient(opts: { fetchImpl?: typeof fetch; now?: () => number; url?: () => string } = {}) {
  const now = opts.now ?? Date.now;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = opts.url ?? (() => process.env.OVERPASS_URL || DEFAULT_URL);
  const cache = new Map<string, { hours: string | null; expiresAt: number }>();
  let backoffUntil = 0;

  /** The `opening_hours` tag of the nearest tagged feature within 40 m of each point (null when none). Never throws. */
  async function hoursForPoints(points: Point[]): Promise<(string | null)[]> {
    const out: (string | null)[] = points.map(() => null);
    try {
      const todo: number[] = [];
      points.forEach((p, i) => {
        if (i >= OSM_MAX_STOPS) return;
        const hit = cache.get(osmHoursKey(p));
        if (hit && hit.expiresAt > now()) out[i] = hit.hours;
        else todo.push(i);
      });
      if (!todo.length || now() < backoffUntil) return out;
      const unique = [...new Map(todo.map((i) => [osmHoursKey(points[i]!), points[i]!])).values()];
      let elements: Element[] | null = null;
      let ttl = OSM_HOURS_TTL_MS;
      try {
        const res = await fetchImpl(url(), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": PHOTO_USER_AGENT, Accept: "application/json" },
          body: new URLSearchParams({ data: buildHoursQuery(unique) }).toString(),
          signal: AbortSignal.timeout(OSM_HOURS_TIMEOUT_MS),
        });
        if (res.status === 429 || res.status === 406) backoffUntil = now() + OSM_BACKOFF_MS;
        if (res.ok) {
          const json: unknown = await res.json();
          const remark = (json as { remark?: unknown } | null)?.remark;
          if (Array.isArray((json as { elements?: unknown } | null)?.elements) && !(typeof remark === "string" && /runtime error/i.test(remark))) elements = parseHoursElements(json);
        }
      } catch {
        elements = null;
      }
      if (!elements) ttl = OSM_FAILURE_TTL_MS;
      for (const i of todo) {
        const p = points[i]!;
        let best: Element | null = null;
        let bestD = OSM_MATCH_RADIUS_M;
        for (const e of elements ?? []) {
          const d = haversineMeters(p, e);
          if (d <= bestD) {
            best = e;
            bestD = d;
          }
        }
        const hours = best?.hours ?? null;
        cache.set(osmHoursKey(p), { hours, expiresAt: now() + ttl });
        out[i] = hours;
      }
      while (cache.size > 500) cache.delete(cache.keys().next().value as string);
    } catch {
      /* no hours */
    }
    return out;
  }

  return { hoursForPoints };
}

export const osmHoursClient = createOsmHoursClient();
