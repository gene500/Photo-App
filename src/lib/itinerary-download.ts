import { staticMapUrl } from "./static-map";
import { renderItineraryPdf, type PdfMap } from "./itinerary-pdf";
import type { ItineraryInput } from "./itinerary";
import type { LightPref, LngLat } from "./types";
import { forecastTarget, weatherLine, type WeatherLine } from "./use-weather";
import { FORECAST_UNAVAILABLE_TEXT } from "./weather";
import { loadForecast } from "./weather-cache";

const FALLBACK: PdfMap = { kind: "fallback" };

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** The static map as an embeddable image; anything that goes wrong (no URL, timeout, bad response) is the fallback, never an error. */
export async function loadMapImage(url: string | null, opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<PdfMap> {
  if (!url) return FALLBACK;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, { signal: controller.signal });
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return FALLBACK;
    const dataUrl = await readDataUrl(await res.blob());
    return dataUrl.startsWith("data:image/") ? { kind: "image", dataUrl } : FALLBACK;
  } catch {
    return FALLBACK;
  } finally {
    clearTimeout(timer);
  }
}

type WeatherStop = { lat: number; lng: number; lightPref: LightPref; arrival: Date | null };

/** One weather line per stop with the same rules as `useWeatherLine`; a failed lookup is null for that stop only. */
export async function loadWeatherLines(a: { stops: WeatherStop[]; unit: "km" | "mi"; timeoutMs?: number }): Promise<(WeatherLine | null)[]> {
  const today = new Date().toISOString().slice(0, 10);
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The forecast queue can wait behind the weather idle gate for a long time; the PDF is better without weather than late.
  const timeout = new Promise<(WeatherLine | null)[]>((resolve) => {
    timer = setTimeout(() => resolve(a.stops.map(() => null)), a.timeoutMs ?? 6000);
  });
  const lines = Promise.all(
    a.stops.map(async (s) => {
      try {
        const target = forecastTarget(s.lat, s.lng, s.arrival, s.lightPref, today);
        if (!target) return null;
        if (!target.inRange) return target.date > today ? { text: FORECAST_UNAVAILABLE_TEXT, quality: null } : null;
        const forecast = await loadForecast(s.lat, s.lng, target.date);
        return weatherLine(forecast, s.lightPref, new Date(target.atMs), a.unit);
      } catch {
        return null;
      }
    }),
  );
  try {
    return await Promise.race([lines, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function createItineraryPdf(a: {
  input: ItineraryInput;
  geometry: LngLat[];
  stops: { lat: number; lng: number }[];
  token: string | null;
}): Promise<Blob> {
  const map = await loadMapImage(staticMapUrl({ stops: a.stops, geometry: a.geometry, token: a.token }));
  return renderItineraryPdf(a.input, map, a.geometry, a.stops);
}

export function saveBlob(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked a moment later: some browsers start the download asynchronously and need the URL until then.
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function mapTokenFromEnv(): string | null {
  if (process.env.NEXT_PUBLIC_MAP_FAKE === "1") return null;
  return process.env.NEXT_PUBLIC_MAPBOX_TOKEN || null;
}
