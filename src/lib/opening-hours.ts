/**
 * A deliberately small reader for OpenStreetMap `opening_hours`. It understands only the common shapes
 * ("24/7", "Mo-Fr 09:00-17:00; Sa 10:00-14:00", "Su off", several ranges per day) and returns null for anything
 * else (holidays, months, sunrise/sunset, week numbers, "+"), so an unclear value never produces a wrong warning.
 */
export type DayHours = [startMin: number, endMin: number][];
/** Index 0 = Monday ... 6 = Sunday; an empty list means closed that day. */
export type WeekHours = DayHours[];

const DAYS = ["mo", "tu", "we", "th", "fr", "sa", "su"];
/** HH:MM, 00:00-23:59, or exactly 24:00 (end of day). Returns minutes since midnight, or null. */
function minutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

function dayIndexes(spec: string): number[] | null {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^([a-z]{2})(?:-([a-z]{2}))?$/.exec(part.trim().toLowerCase());
    if (!m) return null;
    const a = DAYS.indexOf(m[1]!);
    const b = m[2] ? DAYS.indexOf(m[2]) : a;
    if (a < 0 || b < 0) return null;
    for (let i = a; ; i = (i + 1) % 7) {
      out.add(i);
      if (i === b) break;
    }
  }
  return [...out];
}

function ranges(spec: string): DayHours | null {
  const s = spec.trim().toLowerCase();
  if (s === "off" || s === "closed") return [];
  const out: DayHours = [];
  for (const part of s.split(",")) {
    const m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(part.trim());
    if (!m) return null;
    const start = minutes(m[1]!);
    let end = minutes(m[2]!);
    if (start === null || end === null) return null;
    if (end <= start) end += 1440; // past midnight: the end stays unclipped (above 1440) and is also checked on the next day
    out.push([start, end]);
  }
  return out.length ? out : null;
}

export function parseSimpleHours(raw: unknown): WeekHours | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > 300) return null;
  if (text.toLowerCase() === "24/7") return Array.from({ length: 7 }, (): DayHours => [[0, 1440]]);
  const week: WeekHours = Array.from({ length: 7 }, (): DayHours => []);
  let days: number[];
  for (const rule of text.split(";")) {
    const r = rule.trim();
    if (!r) continue;
    const m = /^(?:([A-Za-z]{2}(?:\s*[-,]\s*[A-Za-z]{2})*)\s+)?(.+)$/.exec(r);
    if (!m) return null;
    if (m[1]) {
      const d = dayIndexes(m[1].replace(/\s+/g, ""));
      if (!d) return null;
      days = d;
    } else days = [0, 1, 2, 3, 4, 5, 6];
    const rangeText = m[2]!;
    const day = /^(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}(\s*,\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})*|off|closed)$/i.test(rangeText.trim()) ? ranges(rangeText) : null;
    if (!day) return null;
    for (const i of days) week[i] = day; // a later rule overrides an earlier one for the same day
  }
  return week;
}

const fmt = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export const formatDayHours = (h: DayHours): string => (h.length ? h.map(([a, b]) => `${fmt(a)}-${b === 1440 ? "24:00" : fmt(b)}`).join(", ") : "closed");

export type HoursCheck =
  | { status: "open" }
  | { status: "closed-day" }
  | { status: "closed"; hours: string }
  | { status: "near"; hours: string }
  /** The day itself cannot be told apart from its neighbour (close to midnight, clock only estimated): say nothing. */
  | { status: "unclear" };

/** Margin that absorbs the time-zone/DST approximation (up to about 2 h off) and a typical late opening. */
export const HOURS_MARGIN_MIN = 150;

/** Open at `minute` of weekday `dayIndex`, where `minute` may fall outside 0..1439 (previous or next day). Overnight ranges carry into the next day. */
function openAt(week: WeekHours, dayIndex: number, minute: number): boolean {
  const shift = Math.floor(minute / 1440);
  const m = minute - shift * 1440;
  const d = (((dayIndex + shift) % 7) + 7) % 7;
  const prev = (d + 6) % 7;
  return (week[d] ?? []).some(([a, b]) => m >= a && m <= b) || (week[prev] ?? []).some(([, b]) => m + 1440 <= b);
}

/** Is a place with these hours open at `minuteOfDay` on weekday `dayIndex` (0 = Monday)? "closed" only when closed throughout the margin around that time, "near" when open at some point within it. */
export function checkHours(week: WeekHours, dayIndex: number, minuteOfDay: number): HoursCheck {
  if (openAt(week, dayIndex, minuteOfDay)) return { status: "open" };
  let openNearby = false;
  for (let d = -HOURS_MARGIN_MIN; d <= HOURS_MARGIN_MIN && !openNearby; d += 15) openNearby = openAt(week, dayIndex, minuteOfDay + d);
  const nearMidnight = minuteOfDay < HOURS_MARGIN_MIN || minuteOfDay > 1440 - HOURS_MARGIN_MIN;
  const own = week[dayIndex] ?? [];
  const neighbour = week[(dayIndex + (minuteOfDay < HOURS_MARGIN_MIN ? 6 : 1)) % 7] ?? [];
  const shown = own.length ? own : neighbour;
  if (openNearby) return { status: "near", hours: formatDayHours(shown) };
  if (!own.length) return nearMidnight ? { status: "unclear" } : { status: "closed-day" };
  return { status: "closed", hours: formatDayHours(own) };
}

/** Approximate local clock for a UTC instant: mean solar offset from the longitude (no time-zone database is bundled; zone borders and DST can make it up to about 2 h off). */
export function approxLocal(ms: number, lng: number): { dayIndex: number; minuteOfDay: number } {
  const d = new Date(ms + Math.round(lng / 15) * 3_600_000);
  return { dayIndex: (d.getUTCDay() + 6) % 7, minuteOfDay: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
