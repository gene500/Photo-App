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
