// One-shot browser Geolocation for "Start from my location". Free, no API. The position is returned to the caller only:
// nothing here stores or logs it. The permission prompt appears when getPosition() is called, so call it only on a click.
export type PositionResult =
  | { ok: true; lat: number; lng: number }
  | { ok: false; reason: "unsupported" | "denied" | "unavailable" | "timeout" };

export const GEOLOCATION_TIMEOUT_MS = 8_000;
export const GEOLOCATION_MAX_AGE_MS = 60_000;
/** Our own limit: some browsers (Firefox) call neither callback when the permission prompt is dismissed, so Optimize would stay busy forever. */
export const GEOLOCATION_GIVE_UP_MS = 10_000;

/** Geolocation only works on https (or localhost). */
export function geolocationSupported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator && !!navigator.geolocation && typeof window !== "undefined" && window.isSecureContext !== false;
}

/** About 11 m: plenty for choosing a first stop, and less precise than the device gave. */
const round = (n: number) => Math.round(n * 1e4) / 1e4;

export function getPosition(): Promise<PositionResult> {
  if (!geolocationSupported()) return Promise.resolve({ ok: false, reason: "unsupported" });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: PositionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(giveUp);
      resolve(r);
    };
    const giveUp = setTimeout(() => finish({ ok: false, reason: "timeout" }), GEOLOCATION_GIVE_UP_MS);
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const { latitude, longitude } = p.coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
            finish({ ok: false, reason: "unavailable" });
          } else finish({ ok: true, lat: round(latitude), lng: round(longitude) });
        },
        (e) => finish({ ok: false, reason: e.code === 1 ? "denied" : e.code === 3 ? "timeout" : "unavailable" }),
        { enableHighAccuracy: false, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: GEOLOCATION_MAX_AGE_MS },
      );
    } catch {
      finish({ ok: false, reason: "unavailable" });
    }
  });
}
