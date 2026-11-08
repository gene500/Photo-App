import { solarDateAt } from "./best-time";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isDateOnly(value: string): boolean {
  if (!DATE_ONLY_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** "2026-07-01" -> Date at 2026-07-01T00:00:00Z (how plannedDate is stored). */
export function dateOnlyToUtc(value: string): Date {
  if (!isDateOnly(value)) throw new Error(`Invalid date: ${value}`);
  return new Date(`${value}T00:00:00Z`);
}

/** Date stored at UTC midnight -> "YYYY-MM-DD". */
export function utcToDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A Date's calendar day in the viewer's own time zone -> "YYYY-MM-DD". */
export function localDateOnly(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The start time saved on `from` moved to `to` (both "YYYY-MM-DD"), keeping the viewer's local clock time (so 07:00 stays 07:00
 * across a daylight-saving change). The trips API only accepts a start time on the planned day (the solar day at the first
 * stop's longitude `firstLng`, or any instant that is that day somewhere on Earth when there is no stop), and near solar
 * midnight the one-hour DST difference can put the clock-time result off that day. Then it falls back to the whole-UTC-day
 * shift, which is exactly what the server derives itself when only the planned date is sent (and is always accepted).
 */
export function shiftDepartAtLocal(departAt: string, from: string, to: string, firstLng: number | null = null): string {
  const start = new Date(departAt);
  const days = Math.round((dateOnlyToUtc(to).getTime() - dateOnlyToUtc(from).getTime()) / 86_400_000);
  const byUtcDays = new Date(start.getTime() + days * 86_400_000);
  const local = new Date(start);
  local.setDate(local.getDate() + days); // same local clock time on the new day (JS resolves a skipped/repeated hour)
  const t = local.getTime();
  const day = dateOnlyToUtc(to).getTime();
  const onDay = firstLng === null ? t >= day - 12 * 3_600_000 && t < day + 36 * 3_600_000 : solarDateAt(local, firstLng) === to;
  return (onDay ? local : byUtcDays).toISOString();
}

/** "2026-11-20" -> "Nov 20, 2026": the one way a calendar date is written for reading (not for date inputs). "" when invalid. */
export function formatDateOnly(value: string): string {
  if (!isDateOnly(value)) return "";
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

/** An ISO timestamp -> the same style in the viewer's own time zone; "" when unparseable. */
export function formatInstantDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(d);
}
