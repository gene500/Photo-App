"use client";

import { describeBestTime, type BestTime } from "@/lib/best-time";
import { describeLightHint } from "@/lib/light-windows";
import { describeSunPosition } from "@/lib/sky";
import { useMounted } from "@/lib/use-mounted";
import { useSettings } from "@/components/settings/SettingsProvider";
import { stopColor } from "@/lib/stop-style";
import { useWeatherLine } from "@/lib/use-weather";
import { useHike } from "@/lib/use-hike";
import { formatHikeDistance } from "@/lib/hike";
import { WeatherText } from "@/components/weather/WeatherIcon";
import type { Stop, StopPriority } from "@/lib/types";
import { PriorityPill } from "./PriorityPill";

type Props = {
  stops: Stop[];
  /** Arrival-based lines (best time, weather, light warning) appear only once the route is optimized. */
  optimized: boolean;
  bestTimes: BestTime[];
  arrivals?: (Date | null)[];
  onToggleVisited: (stopId: string, visited: boolean) => void;
  /** May return a promise; the pill shows the new value meanwhile and reverts if it rejects. */
  onPriorityChange: (stopId: string, priority: StopPriority) => void | Promise<unknown>;
  onSelect: (stopId: string) => void;
};

export function TripPlanList({ stops, optimized, bestTimes, arrivals, onToggleVisited, onPriorityChange, onSelect }: Props) {
  if (stops.length === 0) return <p className="text-sm text-muted">No stops yet.</p>;
  return (
    <ol aria-label="Trip plan">
      {stops.map((s, i) => (
        <TripRow key={s.id} stop={s} index={i} first={i === 0} last={i === stops.length - 1} optimized={optimized}
          bestTime={bestTimes[i] ?? null} arrival={arrivals?.[i] ?? null}
          role={stops.length > 1 ? (i === 0 ? "Start" : i === stops.length - 1 ? "End" : null) : null}
          onToggleVisited={onToggleVisited} onPriorityChange={onPriorityChange} onSelect={onSelect}
        />
      ))}
    </ol>
  );
}

/** The lines that need an arrival time. Their own component so the weather lookup only runs once optimized. */
function ArrivalLines({ stop, bestTime, arrival }: { stop: Stop; bestTime: BestTime; arrival: Date | null }) {
  const { settings } = useSettings();
  const mounted = useMounted(); // clock text is in the viewer's time zone: only a placeholder until mounted
  const hint = !mounted ? null : describeLightHint(stop, arrival, undefined, settings.timeFormat);
  // Weather at the arrival (or the stop's light window); silent while loading or when it fails.
  const weather = useWeatherLine(stop.lat, stop.lng, arrival, stop.lightPref);
  return (
    <>
      <p className="flex min-w-0 items-center gap-1.5 text-xs text-foreground/80">
        {hint ? (
          <span data-testid="best-time" data-light-met={hint.met} className={`flex min-w-0 items-center gap-1 ${hint.met ? "" : "text-sand"}`}>
            {hint.met && (
              <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8.5l3.2 3.2L13 4.8" />
              </svg>
            )}
            <span className="min-w-0 break-words">{hint.text}</span>
          </span>
        ) : (
          <span data-testid="best-time">{mounted ? describeBestTime(bestTime, undefined, settings.timeFormat) : " "}</span>
        )}
      </p>
      {/* Sun direction and weather share one row (they wrap on a narrow panel) so the card stays short. */}
      {((mounted && arrival) || weather) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {mounted && arrival && (
            <p data-testid="sun-position" className="text-xs text-foreground/80">{describeSunPosition(stop.lat, stop.lng, arrival)}</p>
          )}
          {weather && (
            <p data-testid="stop-weather" data-light-quality={weather.quality ?? undefined} title={weather.label} className={`text-xs ${weather.quality === "poor" ? "text-sand" : "text-foreground/80"}`}>
              <WeatherText line={weather} />
            </p>
          )}
        </div>
      )}
      {weather?.warning && <p data-testid="light-warning" className="text-xs text-sand">{weather.warning}</p>}
    </>
  );
}

/**
 * "Hike 1.2 mi one way" (distance only). Rendered only when the stop has a hike, so a stop without one reserves no space.
 * The data credit is on the map (the hike source's attribution), not on every card.
 */
function HikeLines({ stop }: { stop: Stop }) {
  const { settings } = useSettings();
  const hike = useHike(stop.id, stop.lat, stop.lng);
  if (!hike) return null;
  return (
    <div data-testid="stop-hike" className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-foreground/80">
      <span>Hike {formatHikeDistance(hike.distanceMeters, settings.distanceUnit)} one way</span>
    </div>
  );
}

function TripRow({ stop, index, first, last, optimized, bestTime, arrival, role, onToggleVisited, onPriorityChange, onSelect }: Pick<Props, "optimized" | "onToggleVisited" | "onPriorityChange" | "onSelect"> & { stop: Stop; index: number; first: boolean; last: boolean; bestTime: BestTime; arrival: Date | null; role: "Start" | "End" | null }) {
  // The timeline line runs through the dot centre (22px down) and stops at the first/last dot.
  const line = first && last ? "hidden" : first ? "top-[22px] bottom-0" : last ? "top-0 h-[22px]" : "inset-y-0";
  return (
    <li data-testid="trip-row" className="relative flex flex-wrap items-start gap-x-3 gap-y-1 rounded-xl py-2 pr-1 text-foreground">
      <span aria-hidden className={`absolute left-[13px] w-px bg-border ${line}`} />
      {/* The dot only shows the stop number (a check once visited); the Visited checkbox at the right edge is the one control. */}
      <span
        data-testid="stop-dot"
        aria-hidden
        className={`relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-4 ring-surface ${stop.visited ? "text-black/75" : "text-white"}`}
        style={{ background: stopColor(stop) }}
      >
        {stop.visited ? (
          <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8.5l3.2 3.2L13 4.8" />
          </svg>
        ) : (
          <span>{index + 1}</span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <button type="button" onClick={() => onSelect(stop.id)} className="block min-h-7 min-w-0 break-words text-left text-sm font-medium leading-7 hover:underline">
            <span className="sr-only">{index + 1}.</span>{" "}{stop.name}
          </button>
          {role && <span data-testid="stop-role" className="shrink-0 rounded-md bg-hover px-1.5 py-px text-xs font-medium text-muted">{role}</span>}
        </div>
        {optimized && <ArrivalLines stop={stop} bestTime={bestTime} arrival={arrival} />}
        <HikeLines stop={stop} />
      </div>
      <label className="relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          aria-label={`Visited: ${stop.name}`}
          className="peer h-5 w-5 cursor-pointer accent-[var(--accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
          checked={stop.visited}
          onChange={(e) => onToggleVisited(stop.id, e.target.checked)}
        />
      </label>
      {stop.lightPref !== "any" && (
        <div className="flex basis-full flex-wrap items-center gap-x-2 gap-y-0.5 pl-10 text-[11px] text-muted" title="Priority: how hard Optimize route works to land this stop in its light">
          <span className="shrink-0">Priority</span>
          <PriorityPill name={stop.name} value={stop.priority} onChange={(p) => onPriorityChange(stop.id, p)} />
        </div>
      )}
    </li>
  );
}
