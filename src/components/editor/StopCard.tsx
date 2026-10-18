"use client";

import { describeBestTime, formatClock } from "@/lib/best-time";
import { useSettings } from "@/components/settings/SettingsProvider";
import { btnSecondary, card, btnIcon } from "@/components/ui/styles";
import { useMounted } from "@/lib/use-mounted";
import { useWeatherLine } from "@/lib/use-weather";
import { WeatherText } from "@/components/weather/WeatherIcon";
import type { BestTime } from "@/lib/best-time";
import type { Stop } from "@/lib/types";

type Props = {
  stop: Stop;
  bestTime: BestTime;
  arrival: Date | null;
  onToggleVisited: (visited: boolean) => void;
  onOpenDetails: () => void;
  onClose: () => void;
};

export function StopCard({ stop, bestTime, arrival, onToggleVisited, onOpenDetails, onClose }: Props) {
  const { settings } = useSettings();
  const mounted = useMounted(); // clock text is in the viewer's time zone
  const weather = useWeatherLine(stop.lat, stop.lng, arrival, stop.lightPref);
  return (
    <section aria-label="Selected stop" className={`space-y-2 rounded-xl p-3 ${card}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="py-1.5 text-sm font-semibold">{stop.name}</p>
        <button type="button" onClick={onClose} aria-label="Close" className={btnIcon}>
          ×
        </button>
      </div>
      <p className="text-xs text-muted">{mounted ? describeBestTime(bestTime, undefined, settings.timeFormat) : "\u00A0"}</p>
      {stop.shotChecklist.length > 0 && (
        <p data-testid="shot-summary" className="text-xs text-muted">
          {stop.shotChecklist.filter((s) => s.done).length}/{stop.shotChecklist.length} shots
        </p>
      )}
      {mounted && arrival && <p className="text-xs text-muted">Arrive ~{formatClock(arrival, undefined, settings.timeFormat)}</p>}
      {weather && (
        <p data-testid="card-weather" data-light-quality={weather.quality ?? undefined} title={weather.label} className={`text-xs ${weather.quality === "poor" ? "text-sand" : "text-muted"}`}>
          <WeatherText line={weather} />
        </p>
      )}
      <div className="flex items-center justify-between">
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-accent-strong" checked={stop.visited} onChange={(e) => onToggleVisited(e.target.checked)} />
          Visited
        </label>
        <button type="button" onClick={onOpenDetails} className={btnSecondary}>
          Open details
        </button>
      </div>
    </section>
  );
}
