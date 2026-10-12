import { addDays } from "@/lib/weather";
import type { WeatherForecast, WeatherHour } from "@/lib/types";
import { PHOTO_USER_AGENT } from "./photo-http";

// Fixed host, no key. Only numbers and validated dates are interpolated into the query.
const API = "https://archive-api.open-meteo.com/v1/archive";
export const TYPICAL_TIMEOUT_MS = 8000;
export const TYPICAL_YEARS = 3;
/** Days either side of the calendar date that are averaged in, to smooth out single odd days. */
export const TYPICAL_SPREAD_DAYS = 3;
export const TYPICAL_TTL_MS = 24 * 60 * 60_000;
/** A failed lookup is remembered briefly so a client looping over places cannot hammer the archive. */
export const TYPICAL_FAILURE_TTL_MS = 60_000;
export const TYPICAL_CACHE_MAX = 1000;
/** A day with at least this much precipitation counts as a wet day. */
const WET_DAY_MM = 1;

type Point = { lat: number; lng: number };
export type TypicalProfile = { utcOffsetSeconds: number; cloud: (number | null)[]; temp: (number | null)[]; wetDayPct: number };

const round2 = (n: number) => n.toFixed(2);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The same calendar day `years` earlier (29 Feb rolls to 1 Mar, which is close enough for an average). */
export function sameDayInYear(date: string, year: number): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, m - 1, d)).toISOString().slice(0, 10);
}

export const typicalCacheKey = (p: Point, date: string) => `${round2(p.lat)},${round2(p.lng)}|${date.slice(5)}`;

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Fold archive responses (one per past year, each holding ~7 days of hourly data) into hour-of-day averages. */
export function buildProfile(responses: unknown[]): TypicalProfile | null {
  const cloud: number[][] = Array.from({ length: 24 }, () => []);
  const temp: number[][] = Array.from({ length: 24 }, () => []);
  let wet = 0;
  let days = 0;
  let offset: number | null = null;
  for (const r of responses) {
    if (typeof r !== "object" || r === null) continue;
    const root = r as { utc_offset_seconds?: unknown; hourly?: Record<string, unknown> };
    const h = root.hourly;
    if (!h || !Array.isArray(h.time)) continue;
    offset ??= num(root.utc_offset_seconds);
    const col = (k: string): unknown[] => (Array.isArray(h[k]) ? (h[k] as unknown[]) : []);
    const [c, p, t] = [col("cloud_cover"), col("precipitation"), col("temperature_2m")];
    const perDay = new Map<string, number>();
    h.time.forEach((time, i) => {
      if (typeof time !== "string") return;
      const hour = Number(time.slice(11, 13));
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;
      const cv = num(c[i]);
      const tv = num(t[i]);
      if (cv !== null) cloud[hour].push(cv);
      if (tv !== null) temp[hour].push(tv);
      const day = time.slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + (num(p[i]) ?? 0));
    });
    for (const total of perDay.values()) {
      days++;
      if (total >= WET_DAY_MM) wet++;
    }
  }
  if (offset === null || days === 0 || cloud.every((x) => x.length === 0)) return null;
  return { utcOffsetSeconds: offset, cloud: cloud.map(mean), temp: temp.map(mean), wetDayPct: Math.round((wet / days) * 100) };
}

/** A forecast-shaped answer for `date` (and the days either side, for midnight edge cases) from a profile. */
export function profileToForecast(profile: TypicalProfile, date: string): WeatherForecast {
  const hours: WeatherHour[] = [];
  for (const day of [addDays(date, -1), date, addDays(date, 1)]) {
    for (let h = 0; h < 24; h++) {
      const cloud = profile.cloud[h];
      hours.push({
        time: `${day}T${String(h).padStart(2, "0")}:00`,
        cloudPct: cloud === null ? null : Math.round(cloud),
        rainPct: profile.wetDayPct,
        tempC: profile.temp[h] === null ? null : Math.round(profile.temp[h]! * 10) / 10,
      });
    }
  }
  return { available: true, utcOffsetSeconds: profile.utcOffsetSeconds, hours, typical: true };
}

/** One archive request per past year for all points at once (Open-Meteo accepts comma-separated coordinates). */
export async function fetchProfiles(points: Point[], date: string, today: string, fetchImpl: typeof fetch = fetch): Promise<(TypicalProfile | null)[]> {
  const lastYear = Number(today.slice(0, 4)) - 1;
  const perYear = await Promise.all(
    Array.from({ length: TYPICAL_YEARS }, async (_, i) => {
      try {
        const centre = sameDayInYear(date, lastYear - i);
        const params = new URLSearchParams({
          latitude: points.map((p) => round2(p.lat)).join(","),
          longitude: points.map((p) => round2(p.lng)).join(","),
          hourly: "cloud_cover,precipitation,temperature_2m",
          timezone: "auto",
          start_date: addDays(centre, -TYPICAL_SPREAD_DAYS),
          end_date: addDays(centre, TYPICAL_SPREAD_DAYS),
        });
        const res = await fetchImpl(`${API}?${params}`, {
          headers: { "User-Agent": PHOTO_USER_AGENT, Accept: "application/json" },
          signal: AbortSignal.timeout(TYPICAL_TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const json: unknown = await res.json();
        const list = Array.isArray(json) ? json : [json];
        return list.length === points.length ? list : null;
      } catch {
        return null;
      }
    }),
  );
  return points.map((_, j) => buildProfile(perYear.flatMap((list) => (list ? [list[j]] : []))));
}

/** Profile lookup with a bounded 24 h cache (keyed by ~1 km and calendar day) and in-flight de-duplication. */
export function createTypicalLookup(opts: { fetchImpl?: typeof fetch; now?: () => number } = {}) {
  const now = opts.now ?? Date.now;
  const store = new Map<string, { profile: TypicalProfile | null; expiresAt: number }>();
  const inFlight = new Map<string, Promise<TypicalProfile | null>>();

  function many(points: Point[], date: string, today = new Date().toISOString().slice(0, 10)): Promise<WeatherForecast[]> {
    const result: Promise<TypicalProfile | null>[] = new Array(points.length);
    const missing = new Map<string, { point: Point; slots: number[] }>();
    points.forEach((p, i) => {
      const key = typicalCacheKey(p, date);
      const hit = store.get(key);
      if (hit && hit.expiresAt > now()) {
        store.delete(key);
        store.set(key, hit);
        result[i] = Promise.resolve(hit.profile);
        return;
      }
      const pending = inFlight.get(key);
      if (pending) {
        result[i] = pending;
        return;
      }
      const entry = missing.get(key) ?? { point: p, slots: [] };
      entry.slots.push(i);
      missing.set(key, entry);
    });
    if (missing.size > 0) {
      const entries = [...missing.entries()];
      const batch = fetchProfiles(entries.map(([, e]) => e.point), date, today, opts.fetchImpl).catch(() => entries.map(() => null));
      entries.forEach(([key, e], j) => {
        const p = batch
          .then((profiles) => {
            const profile = profiles[j] ?? null;
            store.set(key, { profile, expiresAt: now() + (profile ? TYPICAL_TTL_MS : TYPICAL_FAILURE_TTL_MS) });
            while (store.size > TYPICAL_CACHE_MAX) store.delete(store.keys().next().value as string);
            return profile;
          })
          .finally(() => inFlight.delete(key));
        inFlight.set(key, p);
        for (const slot of e.slots) result[slot] = p;
      });
    }
    return Promise.all(result).then((profiles) =>
      profiles.map((pr): WeatherForecast => (pr ? profileToForecast(pr, date) : { available: false, reason: "unavailable" })),
    );
  }

  return Object.assign(many, { size: () => store.size, clear: () => (store.clear(), inFlight.clear()) });
}

export const sharedTypical = createTypicalLookup();
