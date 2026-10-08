// Per-device display settings, kept in localStorage (never sent to the server). Pure helpers only: the React
// provider lives in components/settings. The same key and shape are read by SETTINGS_INIT_SCRIPT before first paint.
import { MAX_DWELL_MINUTES } from "./validation";

export const SETTINGS_KEY = "rtpp.settings.v1";

export const THEMES = ["system", "light", "dark"] as const;
export const TEXT_SIZES = ["default", "large", "xlarge"] as const;
export const DISTANCE_UNITS = ["km", "mi"] as const;
/** "auto" keeps today's clock (en-US 12-hour); the others force it. */
export const TIME_FORMATS = ["auto", "12h", "24h"] as const;
export const MAP_STYLES = ["beige", "standard"] as const;
export const SUGGESTION_LIGHT_PREFS = ["auto", "any"] as const;

export type Theme = (typeof THEMES)[number];
export type TextSize = (typeof TEXT_SIZES)[number];
export type DistanceUnit = (typeof DISTANCE_UNITS)[number];
export type TimeFormat = (typeof TIME_FORMATS)[number];
export type MapStyle = (typeof MAP_STYLES)[number];
export type SuggestionLightPref = (typeof SUGGESTION_LIGHT_PREFS)[number];

export type Settings = {
  theme: Theme;
  textSize: TextSize;
  /** On forces reduced motion; off still honours the device's own preference (see globals.css). */
  reduceMotion: boolean;
  distanceUnit: DistanceUnit;
  timeFormat: TimeFormat;
  mapStyle: MapStyle;
  /** Minutes for a new stop. */
  defaultDwellMinutes: number;
  suggestionLightPref: SuggestionLightPref;
};

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  textSize: "default",
  reduceMotion: false,
  distanceUnit: "km",
  timeFormat: "auto",
  mapStyle: "beige",
  defaultDwellMinutes: 30,
  suggestionLightPref: "auto",
};

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Validate anything (parsed JSON, a partial patch, garbage): every field is checked or clamped, else defaulted. */
export function parseSettings(raw: unknown): Settings {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  const dwell = typeof o.defaultDwellMinutes === "number" && Number.isFinite(o.defaultDwellMinutes)
    ? Math.min(MAX_DWELL_MINUTES, Math.max(0, Math.round(o.defaultDwellMinutes)))
    : d.defaultDwellMinutes;
  return {
    theme: pick(THEMES, o.theme, d.theme),
    textSize: pick(TEXT_SIZES, o.textSize, d.textSize),
    reduceMotion: typeof o.reduceMotion === "boolean" ? o.reduceMotion : d.reduceMotion,
    distanceUnit: pick(DISTANCE_UNITS, o.distanceUnit, d.distanceUnit),
    timeFormat: pick(TIME_FORMATS, o.timeFormat, d.timeFormat),
    mapStyle: pick(MAP_STYLES, o.mapStyle, d.mapStyle),
    defaultDwellMinutes: dwell,
    suggestionLightPref: pick(SUGGESTION_LIGHT_PREFS, o.suggestionLightPref, d.suggestionLightPref),
  };
}

/** Parse the stored JSON string; null/corrupt falls back to defaults. */
export function parseStoredSettings(json: string | null): Settings {
  if (!json) return DEFAULT_SETTINGS;
  try {
    return parseSettings(JSON.parse(json));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

type AttrTarget = Pick<HTMLElement, "setAttribute" | "removeAttribute">;

/** Mirror the appearance settings onto <html>; "system"/default/off remove the attribute so the CSS defaults apply. */
export function applyAppearance(s: Pick<Settings, "theme" | "textSize" | "reduceMotion">, el: AttrTarget): void {
  const set = (name: string, value: string | null) => (value === null ? el.removeAttribute(name) : el.setAttribute(name, value));
  set("data-theme", s.theme === "system" ? null : s.theme);
  set("data-text-size", s.textSize === "default" ? null : s.textSize);
  set("data-reduce-motion", s.reduceMotion ? "true" : null);
}

/**
 * Runs in <head> before first paint so the page never flashes the wrong theme or size. A constant string (no
 * user data is interpolated) that mirrors applyAppearance and never throws.
 */
export const SETTINGS_INIT_SCRIPT =
  '(function(){try{var s=JSON.parse(localStorage.getItem("' +
  SETTINGS_KEY +
  '")||"null");if(!s)return;var e=document.documentElement;' +
  'if(s.theme==="light"||s.theme==="dark")e.setAttribute("data-theme",s.theme);' +
  'if(s.textSize==="large"||s.textSize==="xlarge")e.setAttribute("data-text-size",s.textSize);' +
  'if(s.reduceMotion===true)e.setAttribute("data-reduce-motion","true")}catch(x){}})()';
