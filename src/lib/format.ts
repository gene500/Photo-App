import { formatClock } from "./best-time";
import type { DistanceUnit, TimeFormat } from "./settings";

const METERS_PER_MILE = 1609.344;

export function formatDistance(meters: number, unit: DistanceUnit = "km"): string {
  return unit === "mi" ? `${Math.round(meters / METERS_PER_MILE)} mi` : `${Math.round(meters / 1000)} km`;
}

/** A whole-number radius in km shown in the chosen unit ("10 km" / "6 mi"). */
export function formatRadiusKm(km: number, unit: DistanceUnit = "km"): string {
  return formatDistance(km * 1000, unit);
}

export function formatDuration(seconds: number): string {
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** "≈1.2k photos nearby"; "50+ photos nearby" at the Commons cap; null when there is nothing to say. */
export function formatPhotoCount(n: number | undefined): string | null {
  if (n === undefined || !Number.isFinite(n) || n < 1) return null;
  if (n === 50) return "50+ photos nearby";
  if (n === 1) return "≈1 photo nearby";
  const short = n >= 1000 ? `${(Math.round(n / 100) / 10).toString().replace(/\.0$/, "")}k` : String(Math.round(n));
  return `≈${short} photos nearby`;
}

/** "6/20/2026, 3:00 PM" (or 15:00) for a saved-at ISO timestamp, honouring the time-format setting; "" when unparseable. */
export function formatSavedAt(iso: string, timeFormat: TimeFormat = "auto"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString()}, ${formatClock(d, undefined, timeFormat)}`;
}
