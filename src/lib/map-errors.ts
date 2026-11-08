/** The shape of a Mapbox `error` event that matters here. */
export type MapErrorEvent = { error?: { status?: number; message?: string }; tile?: unknown; sourceId?: string };

/**
 * Whether a map error means the viewer is looking at a blank map: a rejected token (401/403) from anything, or a
 * style-level failure (404, 500, a network error or an aborted request). Ordinary per-tile or per-source errors are not.
 */
export function isMapFatalError(e: MapErrorEvent): boolean {
  const status = e.error?.status;
  if (status === 401 || status === 403) return true;
  if (e.tile || e.sourceId) return false;
  if (typeof status === "number") return status >= 400;
  return /fetch|network|abort|load failed/i.test(e.error?.message ?? "");
}
