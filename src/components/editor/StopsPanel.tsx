"use client";

import { useState, type ReactNode } from "react";

type Snap = "collapsed" | "half" | "full";
type Tab = "stops" | "suggestions";

const BIGGER: Partial<Record<Snap, Snap>> = { collapsed: "half", half: "full" };
const SMALLER: Partial<Record<Snap, Snap>> = { full: "half", half: "collapsed" };
// Phones: a bottom sheet at three heights. lg+: a card on the left (collapsed = header only).
const SNAP_CLASS: Record<Snap, string> = {
  collapsed: "h-14 lg:h-14",
  half: "h-[45dvh] lg:bottom-3 lg:h-auto",
  full: "h-[85dvh] lg:bottom-3 lg:h-auto",
};

type Props = {
  header: ReactNode;
  /** One line shown instead of the header when the panel is collapsed. */
  collapsedSummary: ReactNode;
  summary: ReactNode;
  stops: ReactNode;
  suggestions: ReactNode;
  suggestionCount: number;
};

export function StopsPanel({ header, collapsedSummary, summary, stops, suggestions, suggestionCount }: Props) {
  const [snap, setSnap] = useState<Snap>("half");
  const [tab, setTab] = useState<Tab>("stops");
  const open = snap !== "collapsed";
  const tabClass = (t: Tab) =>
    `min-h-9 rounded-lg px-3 py-1.5 text-sm transition ${tab === t ? "bg-surface font-medium text-foreground shadow-sm" : "text-muted hover:text-foreground"}`;
  const arrowClass = "flex h-9 w-9 items-center justify-center rounded-full text-sm text-muted transition hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent";

  return (
    <aside
      data-snap={snap}
      className={`absolute inset-x-0 bottom-0 z-10 flex flex-col overflow-hidden rounded-t-2xl bg-surface text-foreground shadow-2xl ring-1 ring-border lg:inset-x-auto lg:left-3 lg:top-3 lg:w-[360px] lg:rounded-2xl ${SNAP_CLASS[snap]}`}
    >
      <div className="flex items-start gap-2 px-4 pb-1 pt-3">
        {open ? (
          <div className="min-w-0 flex-1">{header}</div>
        ) : (
          <p className="min-w-0 flex-1 truncate py-2 text-sm font-medium">{collapsedSummary}</p>
        )}
        {/* One arrow per direction, so the arrow always does what it says. */}
        <div className="flex shrink-0">
          {SMALLER[snap] && (
            <button type="button" aria-label="Shrink panel" onClick={() => setSnap(SMALLER[snap]!)} className={arrowClass}>
              ▾
            </button>
          )}
          {BIGGER[snap] && (
            <button type="button" aria-label="Expand panel" onClick={() => setSnap(BIGGER[snap]!)} className={`${arrowClass} ${snap === "half" ? "lg:hidden" : ""}`}>
              ▴
            </button>
          )}
        </div>
      </div>
      {open && (
        <>
          <div className="space-y-2 px-4">{summary}</div>
          <div role="tablist" className="mx-4 mt-3 flex gap-1 rounded-xl bg-hover p-1">
            <button role="tab" type="button" aria-selected={tab === "stops"} className={tabClass("stops")} onClick={() => setTab("stops")}>
              Stops
            </button>
            <button role="tab" type="button" aria-selected={tab === "suggestions"} className={tabClass("suggestions")} onClick={() => setTab("suggestions")}>
              {suggestionCount > 0 ? `Suggestions (${suggestionCount})` : "Suggestions"}
            </button>
          </div>
          <div role="tabpanel" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4 pt-3">
            {tab === "stops" ? stops : suggestions}
          </div>
        </>
      )}
    </aside>
  );
}
