"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { softDisabled } from "@/lib/focus";

type Props = {
  /** The StartTimeControl element: an input the optimizer reads, so it is shown before and after Optimize. */
  startTime: ReactNode;
  optimize: {
    onOptimize: () => void;
    onUndo: (() => void) | null;
    busy: boolean;
    undoing: boolean;
    disabled: boolean;
    status: string;
  };
  routeStatus: string;
  swapNote: ReactNode;
  list: ReactNode;
};

/** Layout of the My trip tab: start time, then Optimize, Undo and the route totals on one row, then the itinerary. */
export function TripPlan({ startTime, optimize, routeStatus, swapNote, list }: Props) {
  return (
    <>
      {startTime}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          {...softDisabled(optimize.disabled)}
          onClick={optimize.disabled ? undefined : optimize.onOptimize}
          className="inline-flex min-h-9 items-center rounded-full bg-ink px-4 text-sm font-medium text-ink-foreground transition hover:opacity-85 aria-disabled:opacity-40"
        >
          {optimize.busy ? "Optimizing…" : "Optimize route"}
        </button>
        <Link
          href="/settings#optimize"
          aria-label="Optimize settings"
          title="Optimize settings"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-hover text-foreground ring-1 ring-border transition hover:bg-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Link>
        {optimize.onUndo && (
          <button
            type="button"
            {...softDisabled(optimize.undoing)}
            onClick={optimize.undoing ? undefined : optimize.onUndo}
            className="inline-flex min-h-9 items-center rounded-full bg-hover px-4 text-sm font-medium text-foreground ring-1 ring-border transition active:scale-[0.97] hover:bg-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
          >
            Undo
          </button>
        )}
        {/* The one live region (always mounted so a text change is announced once). Empty: screen-reader only. With a result: an inline notice on its own line under the buttons, so it is visible to everyone and covers nothing. */}
        <p
          role="status"
          data-testid="optimize-status"
          className={optimize.status ? "order-last basis-full rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent-foreground ring-1 ring-border" : "sr-only"}
        >
          {optimize.status}
        </p>
        <p data-testid="route-status" className="text-sm font-medium text-foreground">{routeStatus}</p>
      </div>
      {swapNote}
      {list}
    </>
  );
}
