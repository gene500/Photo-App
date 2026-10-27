"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Render stamps this browser tab has already shown. The stamp is an opaque id, never compared with the browser's clock,
 * so a slow load or a skewed clock cannot trigger a refresh.
 */
const seenStamps = new Set<number>();

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
  useEffect(() => {
    const seenBefore = seenStamps.has(renderedAt);
    seenStamps.add(renderedAt);
    if (checked.current) return;
    checked.current = true;
    if (seenBefore || loadedFromHistory()) router.refresh();
  }, [renderedAt, router]);
  return null;
}
