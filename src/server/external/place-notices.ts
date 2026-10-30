import { addDays } from "@/lib/weather";
import { approxLocal, checkHours, parseSimpleHours } from "@/lib/opening-hours";
import { MAX_NOTICES_PER_STOP } from "@/lib/nps-alerts";
import type { PlaceNotice } from "@/lib/types";
import { fakePlaceNotices, isFakeExternal } from "./fake";
import { npsClient } from "./nps-alerts";
import { osmHoursClient, OSM_MAX_STOPS } from "./osm-hours";

/** Optimize never waits longer than this for notices; whatever has not arrived is simply left out. */
export const NOTICES_DEADLINE_MS = 3000;
/** Alerts describe today's situation, so they are only shown for a trip planned within this many days ahead. */
export const NPS_HORIZON_DAYS = 14;

export type NoticeStop = { lat: number; lng: number; /** Estimated arrival (ms since epoch) for opening hours; omit to skip hours. */ arrivalMs?: number };
type Alert = { kind: "closed" | "alert"; text: string };
type Deps = {
  nps?: { alertsForPoints(points: { lat: number; lng: number }[]): Promise<Alert[][]> };
  osm?: { hoursForPoints(points: { lat: number; lng: number }[]): Promise<(string | null)[]> };
  deadlineMs?: number;
  today?: string;
};

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

/**
 * Heads-ups for the stops of a trip on `date`: NPS closures/alerts near each stop and OpenStreetMap opening hours.
 * Only coordinates and the date leave the server. It never throws and never takes longer than the deadline.
 */
export async function collectPlaceNotices(stops: NoticeStop[], date: string, deps: Deps = {}): Promise<PlaceNotice[]> {
  try {
    if (!stops.length) return [];
    if (isFakeExternal()) return fakePlaceNotices(stops);
    const deadline = deps.deadlineMs ?? NOTICES_DEADLINE_MS;
    const today = deps.today ?? new Date().toISOString().slice(0, 10);
    const nps = deps.nps ?? npsClient;
    const osm = deps.osm ?? osmHoursClient;
    const alertsWanted = date >= addDays(today, -1) && date <= addDays(today, NPS_HORIZON_DAYS);
    const hoursPoints = stops.slice(0, OSM_MAX_STOPS);
    const wantHours = hoursPoints.some((s) => Number.isFinite(s.arrivalMs));
    const [alerts, hours] = await Promise.all([
      alertsWanted ? withDeadline(nps.alertsForPoints(stops), deadline, [] as Alert[][]) : Promise.resolve([] as Alert[][]),
      wantHours ? withDeadline(osm.hoursForPoints(hoursPoints), deadline, [] as (string | null)[]) : Promise.resolve([] as (string | null)[]),
    ]);
    const out: PlaceNotice[] = [];
    stops.forEach((s, i) => {
      const list = [...(alerts[i] ?? [])].sort((a, b) => Number(b.kind === "closed") - Number(a.kind === "closed")).slice(0, MAX_NOTICES_PER_STOP);
      for (const a of list) out.push({ stopIndex: i, kind: a.kind, text: a.text, source: "NPS" });
      const raw = hours[i];
      if (raw && s.arrivalMs !== undefined && Number.isFinite(s.arrivalMs)) {
        const week = parseSimpleHours(raw);
        if (!week) return;
        const local = approxLocal(s.arrivalMs, s.lng);
        const c = checkHours(week, local.dayIndex, local.minuteOfDay);
        if (c.status === "closed-day") out.push({ stopIndex: i, kind: "closed", text: `Probably closed on ${DAY_NAMES[local.dayIndex]} (hours from OpenStreetMap)`, source: "OpenStreetMap" });
        else if (c.status === "closed") out.push({ stopIndex: i, kind: "closed", text: `Probably closed at arrival: open ${c.hours} (OpenStreetMap)`, source: "OpenStreetMap" });
        else if (c.status === "near") out.push({ stopIndex: i, kind: "hours", text: `Check the hours: open ${c.hours} (OpenStreetMap)`, source: "OpenStreetMap" });
      }
    });
    return out;
  } catch {
    return [];
  }
}
