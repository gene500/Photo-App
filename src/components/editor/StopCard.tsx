"use client";

import { describeBestTime, formatClock } from "@/lib/best-time";
import { btnSecondary, card } from "@/components/ui/styles";
import { useWeatherLine } from "@/lib/use-weather";
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
  const weather = useWeatherLine(stop.lat, stop.lng, stop.lightPref !== "any" ? arrival : null, stop.lightPref);
  return (
    <section aria-label="Selected stop" className={`space-y-2 rounded-xl p-3 ${card}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="py-1.5 text-sm font-semibold">{stop.name}</p>
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none text-muted hover:bg-hover">
          ×
        </button>
      </div>
      <p className="text-xs text-muted">{describeBestTime(bestTime)}</p>
      {stop.shotChecklist.length > 0 && (
        <p data-testid="shot-summary" className="text-xs text-muted">
          {stop.shotChecklist.filter((s) => s.done).length}/{stop.shotChecklist.length} shots
        </p>
      )}
      {arrival && <p className="text-xs text-muted">Arrive ~{formatClock(arrival)}</p>}
      {weather && (
        <p data-testid="card-weather" data-light-quality={weather.quality ?? undefined} className={`text-xs ${weather.quality === "poor" ? "text-danger" : "text-muted"}`}>
          {weather.text}
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
