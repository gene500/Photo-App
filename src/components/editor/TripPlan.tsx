"use client";

import Link from "next/link";
import { useRef, type ReactNode } from "react";
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
    /** The status sentences before they are joined: a long "Can't fit N stops ...: names" one is collapsed behind its count. Without it the plain `status` text is shown. */
    statusParts?: string[];
    /** Why Optimize is unavailable (read out with the button), when that is not just "busy". */
    reason?: string;
    /** The "Start from my location" setting is on: a short note says Optimize will use the device's position. */
    usingLocation?: boolean;
  };
  routeStatus: string;
  swapNote: ReactNode;
  list: ReactNode;
};

/** More names than this are folded into a native <details> under the count. */
const NAMES_SHOWN_INLINE = 2;
const FIT_NOTE = /^(Can't fit (\d+) stops? in (?:its|their) light|Can't fit (\d+) stops? in daylight): (.+)$/;

/** The status sentences joined the way the live-region text reads (". " between, one final "."), with a long list of stop names collapsed. A closed <details> is not read by screen readers, so when one is shown the full sentence is also in a screen-reader-only copy and the visual one is hidden from them. */
function StatusText({ status, parts }: { status: string; parts?: string[] }) {
  if (!parts) return <>{status}</>;
  const folded = parts.some((part) => {
    const m = FIT_NOTE.exec(part.replace(/\.$/, ""));
    return m && Number(m[2] ?? m[3]) > NAMES_SHOWN_INLINE;
  });
  const visual = (
    <>
      {parts.map((part, i) => {
        const end = i === parts.length - 1 ? "." : ". ";
        const text = part.replace(/\.$/, "");
        const m = FIT_NOTE.exec(text);
        if (m && Number(m[2] ?? m[3]) > NAMES_SHOWN_INLINE) {
          return (
            <details key={i} className="my-0.5">
              <summary className="cursor-pointer rounded font-medium focus-visible:outline-2 focus-visible:outline-accent-strong">{m[1]}:</summary>{" "}
              <span>{m[4]}{end}</span>
            </details>
          );
        }
        return <span key={i}>{text}{end}</span>;
      })}
    </>
  );
  if (!folded) return visual;
  return (
    <>
      <span className="sr-only">{status}</span>
      <span aria-hidden="true">{visual}</span>
    </>
  );
}

/** Layout of the My trip tab: start time, then Optimize, Undo and the route totals on one row, then the itinerary. */
export function TripPlan({ startTime, optimize, routeStatus, swapNote, list }: Props) {
  const optimizeRef = useRef<HTMLButtonElement>(null);
  const reason = optimize.disabled ? optimize.reason : undefined;
  return (
    <>
      {/* Start time, the buttons and the route totals are one group, so they sit close together. */}
      <div className="space-y-1.5">
      {startTime}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          ref={optimizeRef}
          aria-describedby={reason ? "optimize-reason" : undefined}
          {...softDisabled(optimize.disabled)}
          onClick={optimize.disabled ? undefined : optimize.onOptimize}
          className="inline-flex min-h-9 items-center rounded-full bg-ink px-4 text-sm font-medium text-ink-foreground transition hover:opacity-85 aria-disabled:opacity-40"
        >
          {optimize.busy ? "Optimizing…" : "Optimize route"}
        </button>
        {reason && <span id="optimize-reason" className="sr-only">{reason}</span>}
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
        {optimize.usingLocation && <p className="basis-full text-xs text-muted">Using your location</p>}
        {optimize.onUndo && (
          <button
            type="button"
            {...softDisabled(optimize.undoing)}
            onClick={
              optimize.undoing
                ? undefined
                : () => {
                    optimize.onUndo?.();
                    // The Undo button leaves once it has run: hand focus to the button that makes sense next.
                    optimizeRef.current?.focus();
                  }
            }
            className="inline-flex min-h-9 items-center rounded-full bg-hover px-4 text-sm font-medium text-foreground ring-1 ring-border transition active:scale-[0.97] hover:bg-border aria-disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
          >
            Undo
          </button>
        )}
        {/* The one live region (always mounted so a text change is announced once). Empty: screen-reader only. With a result: an inline notice on its own line under the buttons, so it is visible to everyone and covers nothing. */}
        <div
          role="status"
          data-testid="optimize-status"
          className={optimize.status ? "order-last basis-full rounded-lg bg-accent-soft px-3 py-2 text-sm min-w-0 max-w-full [overflow-wrap:anywhere] text-accent-foreground dark:text-foreground ring-1 ring-border" : "sr-only"}
        >
          <StatusText status={optimize.status} parts={optimize.statusParts} />
        </div>
        <p data-testid="route-status" className="text-sm font-medium text-foreground">{routeStatus}</p>
      </div>
      </div>
      {swapNote}
      {list}
    </>
  );
}
