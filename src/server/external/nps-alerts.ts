import { classifyAlert, nearestPark, parseNpsAlerts, parseNpsParks, shortText, type NpsAlert, type NpsPark } from "@/lib/nps-alerts";
import { PHOTO_USER_AGENT } from "./photo-http";

// Fixed host. The key is sent in the X-Api-Key header (never in the URL) and is never logged.
const API = "https://developer.nps.gov/api/v1";
export const NPS_TIMEOUT_MS = 8000;
export const NPS_PARKS_TTL_MS = 24 * 60 * 60_000;
export const NPS_ALERTS_TTL_MS = 60 * 60_000;
/** A failure (including a 429) is remembered briefly so an NPS outage or a spent hourly allowance is not hammered. */
export const NPS_FAILURE_TTL_MS = 5 * 60_000;
export const NPS_MAX_PARKS_PER_REQUEST = 10;

export const npsKey = (): string | null => process.env.NPS_API_KEY?.trim() || null;

type Entry<T> = { value: T; expiresAt: number };

export function createNpsClient(opts: { fetchImpl?: typeof fetch; now?: () => number; key?: () => string | null } = {}) {
  const now = opts.now ?? Date.now;
  const key = opts.key ?? npsKey;
  const fetchImpl = opts.fetchImpl ?? fetch;
  let parks: Entry<NpsPark[]> | null = null;
  let parksInFlight: Promise<NpsPark[]> | null = null;
  const alerts = new Map<string, Entry<NpsAlert[]>>();
  const alertsInFlight = new Map<string, Promise<NpsAlert[]>>();

  async function get(path: string, k: string): Promise<unknown> {
    const res = await fetchImpl(`${API}${path}`, {
      headers: { "User-Agent": PHOTO_USER_AGENT, Accept: "application/json", "X-Api-Key": k },
      signal: AbortSignal.timeout(NPS_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`NPS ${res.status}`);
    return res.json();
  }

  /** All parks (about 470 rows) once a day; the promise keeps running even if a caller gave up waiting. */
  function getParks(): Promise<NpsPark[]> {
    const k = key();
    if (!k) return Promise.resolve([]);
    if (parks && parks.expiresAt > now()) return Promise.resolve(parks.value);
    if (parksInFlight) return parksInFlight;
    parksInFlight = get("/parks?limit=600", k)
      .then((json) => {
        const list = parseNpsParks(json);
        parks = { value: list, expiresAt: now() + (list.length ? NPS_PARKS_TTL_MS : NPS_FAILURE_TTL_MS) };
        return list;
      })
      .catch(() => {
        parks = { value: [], expiresAt: now() + NPS_FAILURE_TTL_MS };
        return [] as NpsPark[];
      })
      .finally(() => {
        parksInFlight = null;
      });
    return parksInFlight;
  }

  /** Alerts for a set of park codes: one request for the codes not cached. */
  async function getAlerts(codes: string[]): Promise<NpsAlert[]> {
    const k = key();
    if (!k) return [];
    const unique = [...new Set(codes)].slice(0, NPS_MAX_PARKS_PER_REQUEST);
    const missing = unique.filter((c) => !((alerts.get(c)?.expiresAt ?? 0) > now()));
    if (missing.length) {
      const id = [...missing].sort().join(",");
      let p = alertsInFlight.get(id);
      if (!p) {
        p = get(`/alerts?parkCode=${encodeURIComponent(id)}&limit=100`, k)
          .then((json) => {
            const list = parseNpsAlerts(json);
            for (const c of missing) alerts.set(c, { value: list.filter((a) => a.parkCode === c), expiresAt: now() + NPS_ALERTS_TTL_MS });
            return list;
          })
          .catch(() => {
            for (const c of missing) alerts.set(c, { value: [], expiresAt: now() + NPS_FAILURE_TTL_MS });
            return [] as NpsAlert[];
          })
          .finally(() => alertsInFlight.delete(id));
        alertsInFlight.set(id, p);
      }
      await p;
    }
    return unique.flatMap((c) => alerts.get(c)?.value ?? []);
  }

  /** Closure and road/trail alerts for each point, by index. Never throws. */
  async function alertsForPoints(points: { lat: number; lng: number }[]): Promise<{ text: string; kind: "closed" | "alert" }[][]> {
    const empty = points.map(() => [] as { text: string; kind: "closed" | "alert" }[]);
    try {
      if (!key()) return empty;
      const list = await getParks();
      if (!list.length) return empty;
      const matched = points.map((p) => nearestPark(list, p.lat, p.lng));
      const codes = matched.flatMap((m) => (m ? [m.parkCode] : []));
      if (!codes.length) return empty;
      const all = await getAlerts(codes);
      return matched.map((m) => {
        if (!m) return [];
        const seen = new Set<string>();
        return all
          .filter((a) => a.parkCode === m.parkCode)
          .flatMap((a) => {
            const kind = classifyAlert(a);
            const text = kind ? shortText(`${a.title} (NPS alert)`) : null;
            if (!kind || !text || seen.has(text)) return [];
            seen.add(text);
            return [{ kind, text }];
          });
      });
    } catch {
      return empty;
    }
  }

  return { alertsForPoints, getParks, getAlerts };
}

export const npsClient = createNpsClient();
