export function formatDistance(meters: number): string {
  return `${Math.round(meters / 1000)} km`;
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
