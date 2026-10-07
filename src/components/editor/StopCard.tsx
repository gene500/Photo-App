"use client";

import { describeBestTime, formatClock } from "@/lib/best-time";
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
  return (
    <section aria-label="Selected stop" className="space-y-2 rounded-xl border bg-white p-3 text-gray-900 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">{stop.name}</p>
        <button type="button" onClick={onClose} aria-label="Close" className="px-1 text-lg leading-none text-gray-500">
          ×
        </button>
      </div>
      <p className="text-xs text-gray-600">{describeBestTime(bestTime)}</p>
      {arrival && <p className="text-xs text-gray-600">Arrive ~{formatClock(arrival)}</p>}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={stop.visited} onChange={(e) => onToggleVisited(e.target.checked)} />
          Visited
        </label>
        <button type="button" onClick={onOpenDetails} className="rounded border px-3 py-1 text-sm">
          Open details
        </button>
      </div>
    </section>
  );
}
