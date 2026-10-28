"use client";

import { focusFirst } from "@/lib/focus";
import { useShortLandscape } from "@/lib/short-landscape";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

type Snap = "collapsed" | "half" | "full";
type Tab = "stops" | "trip" | "suggestions";

const TABS: Tab[] = ["stops", "trip", "suggestions"];

const BIGGER: Partial<Record<Snap, Snap>> = { collapsed: "half", half: "full" };
const SMALLER: Partial<Record<Snap, Snap>> = { full: "half", half: "collapsed" };
// Phones: a bottom sheet at three heights. lg+: a card on the left (collapsed = header only).
const SNAP_CLASS: Record<Snap, string> = {
  collapsed: "h-14 lg:h-14",
  half: "h-[45dvh] lg:bottom-3 lg:h-auto",
  full: "h-[min(85dvh,calc(100dvh-7.25rem))] lg:bottom-3 lg:h-auto",
};

type Props = {
  header: ReactNode;
  /** One line shown instead of the header when the panel is collapsed. */
  collapsedSummary: ReactNode;
  summary: ReactNode;
  stops: ReactNode;
  trip: ReactNode;
  suggestions: ReactNode;
  suggestionCount: number;
};

export function StopsPanel({ header, collapsedSummary, summary, stops, trip, suggestions, suggestionCount }: Props) {
  const [snap, setSnap] = useState<Snap>("half");
  const [tab, setTab] = useState<Tab>("stops");
  // Coming back from Settings (or a reload) reopens the tab and height the user left, kept per page for this browser tab.
  // The router's pathname follows client-side navigation; window.location is only the fallback outside the router.
  const pathname = usePathname();
  const storeKey = pathname === null ? null : `rtpp.panel.v1:${pathname}`;
  const keyNow = () => storeKey ?? `rtpp.panel.v1:${window.location.pathname}`;
  // After a restore, the save effect that runs in the same commit must not write the default state over the saved one (Strict Mode runs both effects twice in dev).
  const skipSaveRef = useRef(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(keyNow()) ?? "null") as { tab?: unknown; snap?: unknown } | null;
      // Restoring after mount (not in the initial state) keeps the server and first client render identical.
      /* eslint-disable react-hooks/set-state-in-effect */
      if (saved) skipSaveRef.current = true;
      if (typeof saved?.tab === "string" && (TABS as string[]).includes(saved.tab)) setTab(saved.tab as Tab);
      if (typeof saved?.snap === "string" && Object.hasOwn(SNAP_CLASS, saved.snap)) setSnap(saved.snap as Snap);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      // Storage blocked: start on Stops as before.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyNow only reads storeKey
  }, [storeKey]);
  useEffect(() => {
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    try {
      window.sessionStorage.setItem(keyNow(), JSON.stringify({ tab, snap }));
    } catch {
      // Storage blocked: nothing to remember.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyNow only reads storeKey
  }, [storeKey, tab, snap]);
  // A arrow that unmounts when it is pressed (▾ at the last height) would drop keyboard focus to the page: keep it on the arrow that is left.
  const shrinkRef = useRef<HTMLButtonElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const refocus = useRef<"shrink" | "expand" | null>(null);
  useEffect(() => {
    const pressed = refocus.current;
    if (!pressed) return;
    refocus.current = null;
    const [first, second] = pressed === "shrink" ? [shrinkRef, expandRef] : [expandRef, shrinkRef];
    // Expand is hidden on wide screens at the middle height (lg:hidden), so focus() on it does nothing there:
    // fall back to the other arrow, then the selected tab, which are always visible.
    focusFirst(first.current, second.current, tabRefs.current[tab]);
  }, [snap, tab]);

  const uid = useId();
  const tabId = (t: Tab) => `${uid}-tab-${t}`;
  const panelId = `${uid}-panel`;
  // ARIA tab pattern: arrows (and Home/End) move between the tabs, selecting and focusing the new one.
  function onTabKey(e: KeyboardEvent<HTMLElement>) {
    const at = TABS.indexOf(tab);
    const next = e.key === "ArrowRight" ? (at + 1) % TABS.length : e.key === "ArrowLeft" ? (at + TABS.length - 1) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    setTab(TABS[next]!);
    tabRefs.current[TABS[next]!]?.focus();
  }
  // Short landscape: a side panel that is always fully open (no sheet heights), so the sheet controls are not shown.
  const side = useShortLandscape();
  const open = side || snap !== "collapsed";
  const tabClass = (t: Tab) =>
    `min-h-9 flex-1 rounded-lg px-3 py-1.5 text-center text-sm transition ${tab === t ? "bg-surface font-medium text-foreground shadow-sm" : "text-muted hover:text-foreground"}`;
  const arrowClass = "flex h-9 w-9 items-center justify-center rounded-full bg-hover text-2xl leading-none text-foreground ring-1 ring-border transition hover:bg-border focus-visible:outline-2 focus-visible:outline-accent-strong";

  return (
    <aside
      aria-label="Trip panel"
      data-snap={snap}
      className={`absolute inset-x-0 bottom-0 z-10 short-landscape:z-[16] lg:[@media(max-height:30rem)]:z-[16] flex flex-col overflow-hidden rounded-t-2xl bg-surface text-foreground shadow-2xl ring-1 ring-border lg:inset-x-auto lg:left-3 lg:top-3 lg:w-[22.5rem] lg:rounded-2xl short-landscape:inset-y-0 short-landscape:left-0 short-landscape:right-auto short-landscape:h-auto short-landscape:w-[clamp(17.5rem,40%,23.75rem)] short-landscape:overflow-y-auto short-landscape:overflow-x-hidden short-landscape:rounded-none short-landscape:pb-[env(safe-area-inset-bottom)] short-landscape:pl-[env(safe-area-inset-left)] ${SNAP_CLASS[snap]}`}
    >
      {/* Wraps (arrows drop below) only when the header could not keep a readable width beside them, e.g. 200% text on a phone. */}
      <div className="flex flex-wrap items-start gap-x-2 px-4 pb-1 pt-3">
        {open ? (
          <div className="min-w-[8rem] flex-1">{header}</div>
        ) : (
          <p className="min-w-0 flex-1 truncate py-2 text-sm font-medium">{collapsedSummary}</p>
        )}
        {/* One arrow per direction, so the arrow always does what it says. */}
        {!side && <div className="ml-auto flex shrink-0">
          {SMALLER[snap] && (
            <button type="button" ref={shrinkRef} aria-label="Shrink panel" onClick={() => { refocus.current = "shrink"; setSnap(SMALLER[snap]!); }} className={arrowClass}>
              ▾
            </button>
          )}
          {BIGGER[snap] && (
            <button type="button" ref={expandRef} aria-label="Expand panel" onClick={() => { refocus.current = "expand"; setSnap(BIGGER[snap]!); }} className={`${arrowClass} ${snap === "half" ? "lg:hidden" : ""}`}>
              ▴
            </button>
          )}
        </div>}
      </div>
      {open && (
        <>
          <div className="space-y-2 px-4">{summary}</div>
          <div role="tablist" onKeyDown={onTabKey} className="mx-4 mt-3 flex flex-wrap gap-1 rounded-xl bg-hover p-1">
            <button role="tab" type="button" id={tabId("stops")} ref={(el) => { tabRefs.current.stops = el; }} aria-selected={tab === "stops"} aria-controls={panelId} tabIndex={tab === "stops" ? 0 : -1} className={tabClass("stops")} onClick={() => setTab("stops")}>
              Stops
            </button>
            <button role="tab" type="button" id={tabId("trip")} ref={(el) => { tabRefs.current.trip = el; }} aria-selected={tab === "trip"} aria-controls={panelId} tabIndex={tab === "trip" ? 0 : -1} className={tabClass("trip")} onClick={() => setTab("trip")}>
              My trip
            </button>
            <button role="tab" type="button" id={tabId("suggestions")} ref={(el) => { tabRefs.current.suggestions = el; }} aria-selected={tab === "suggestions"} aria-controls={panelId} tabIndex={tab === "suggestions" ? 0 : -1} className={tabClass("suggestions")} onClick={() => setTab("suggestions")}>
              {suggestionCount > 0 ? `Suggestions (${suggestionCount})` : "Suggestions"}
            </button>
          </div>
          <div role="tabpanel" id={panelId} aria-labelledby={tabId(tab)} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4 pt-3 short-landscape:min-h-fit short-landscape:flex-none short-landscape:overflow-visible">
            {tab === "stops" ? stops : tab === "trip" ? trip : suggestions}
          </div>
        </>
      )}
    </aside>
  );
}
