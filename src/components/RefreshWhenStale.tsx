"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Render stamps this browser tab has already shown. The stamp is an opaque id, never compared with the browser's clock,
 * so a slow load or a skewed clock cannot trigger a refresh.
 */
const seenStamps = new Set<number>();
/** Stamps known to come straight from the server (not a cached or history copy). */
const freshStamps = new Set<number>();

/** True when this render stamp is known to be current: shown for the first time and not restored from history. Pages use it before acting on their data (pruning offline copies). */
export function isKnownFresh(renderedAt: number): boolean {
  return freshStamps.has(renderedAt);
}

/** Dispatched when a write finished after its page was left: a list page that is open now reloads itself. */
export const WRITE_LANDED_EVENT = "rtpp:write-landed";

/** True when the browser itself restored this document from history (a reload of an old HTML copy on Back/Forward). */
function loadedFromHistory(): boolean {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return nav?.type === "back_forward";
  } catch {
    return false;
  }
}

/**
 * Back and Forward restore a page from the router's client cache, and that copy can be old (the trip changed, a trip was
 * created). The server stamps each render. A stamp this tab has already shown is a cached copy being shown again, so ask
 * the server for a fresh render once; a stamp seen for the first time came straight from the server. (Once per mount, so
 * it can never loop.) A page the browser reloaded from history (Back after a full load) is refreshed too.
 */
export function RefreshWhenStale({ renderedAt }: { renderedAt: number }) {
  const router = useRouter();
  const checked = useRef(false);
  const decidedFor = useRef<number | null>(null); // an effect re-run for the same stamp (Strict Mode) must not turn it into a cached copy
  useEffect(() => {
    if (decidedFor.current === renderedAt) return;
    decidedFor.current = renderedAt;
    const seenBefore = seenStamps.has(renderedAt);
    seenStamps.add(renderedAt);
    // A stamp shown again (Back/Forward) is a cached copy, however fresh it was the first time; a page the browser reloaded
    // from history is old too; a new stamp arriving later in the same mount is the answer to our own refresh.
    if (!seenBefore && (checked.current || !loadedFromHistory())) freshStamps.add(renderedAt);
    else freshStamps.delete(renderedAt);
    if (checked.current) return;
    checked.current = true;
    if (seenBefore || loadedFromHistory()) router.refresh();
  }, [renderedAt, router]);
  // A slow save or add that finished after the editor was closed: the list shown now may predate it.
  useEffect(() => {
    const onLanded = () => router.refresh();
    window.addEventListener(WRITE_LANDED_EVENT, onLanded);
    return () => window.removeEventListener(WRITE_LANDED_EVENT, onLanded);
  }, [router]);
  return null;
}
