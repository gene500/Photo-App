"use client";

import type { ReactNode } from "react";

type Props = {
  /** The StartTimeControl element: an input the optimizer reads, so it is shown before and after Optimize. */
  startTime: ReactNode;
  optimize: {
    onOptimize: () => void;
    onUndo: (() => void) | null;
    busy: boolean;
    undoing: boolean;
    disabled: boolean;
    hint: string | null;
    status: string;
  };
  routeStatus: string;
  swapNote: ReactNode;
  list: ReactNode;
};

/** Layout of the My trip tab: start time, Optimize and Undo, route totals, then the itinerary. */
export function TripPlan({ startTime, optimize, routeStatus, swapNote, list }: Props) {
  return (
    <>
      {startTime}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={optimize.onOptimize}
          disabled={optimize.disabled}
          className="inline-flex min-h-9 items-center rounded-full bg-ink px-4 text-sm font-medium text-ink-foreground transition hover:opacity-85 disabled:opacity-40"
        >
          {optimize.busy ? "Optimizing…" : "Optimize route"}
        </button>
        {optimize.onUndo && (
          <button
            type="button"
            onClick={optimize.onUndo}
            disabled={optimize.undoing}
            className="inline-flex min-h-9 items-center rounded-full bg-hover px-4 text-sm font-medium text-foreground ring-1 ring-border transition active:scale-[0.97] hover:bg-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
          >
            Undo
          </button>
        )}
        {optimize.hint && <p className="text-xs text-muted">{optimize.hint}</p>}
        {/* Screen-reader only: always mounted so a text change is announced; nothing shows under the button. */}
        <p role="status" data-testid="optimize-status" className="sr-only">{optimize.status}</p>
      </div>
      <p data-testid="route-status" className="text-sm text-muted">{routeStatus}</p>
      {swapNote}
      {list}
    </>
  );
}
