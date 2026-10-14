"use client";

import { useEffect, useRef, useState } from "react";
import { loadPlacePhoto } from "@/lib/place-photo-cache";
import type { Suggestion } from "@/lib/types";
import { createSuggestionPopupContent, POPUP_PHOTO_WIDTH } from "./suggestion-popup";

const GAP = 12;
const EST_HEIGHT = 230; // until the card has been measured
const MARGIN = 8;

/** True when the card fits beside the row on at least one side; otherwise it would cover the row and its buttons. */
export function hasRoomBeside(anchor: DOMRect): boolean {
  const need = POPUP_PHOTO_WIDTH + GAP;
  return window.innerWidth - anchor.right >= need + GAP || anchor.left >= need + 8;
}

/** The photo card shown beside a suggestion in the list while it is hovered (the map dot has its own popup). */
export function SuggestionHoverPhoto({ suggestion, anchor }: { suggestion: Suggestion; anchor: DOMRect }) {
  const host = useRef<HTMLDivElement>(null);
  const { osmId, name, lat, lng } = suggestion;
  // The card grows when its photo and credit line arrive, so its real height is tracked to keep all of it on screen.
  const [height, setHeight] = useState(EST_HEIGHT);

  useEffect(() => {
    const node = host.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight || EST_HEIGHT));
    observer.observe(node);
    setHeight(node.offsetHeight || EST_HEIGHT);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const content = createSuggestionPopupContent(suggestion, () => loadPlacePhoto({ key: osmId, name, lat, lng }));
    node.replaceChildren(content);
    return () => node.replaceChildren();
    // The card is rebuilt only when it is a different place; popularity arriving later is not worth a flicker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osmId]);

  // Beside the card: to its right when there is room, otherwise to its left, kept inside the window.
  const room = window.innerWidth - anchor.right;
  const left = room >= POPUP_PHOTO_WIDTH + GAP * 2 ? anchor.right + GAP : Math.max(8, anchor.left - POPUP_PHOTO_WIDTH - GAP);
  const top = Math.min(Math.max(MARGIN, anchor.top + anchor.height / 2 - height / 2), Math.max(MARGIN, window.innerHeight - height - MARGIN));

  return (
    <div
      ref={host}
      data-testid="suggestion-hover-photo"
      aria-hidden
      className="pointer-events-none fixed z-50 overflow-hidden rounded-xl shadow-lg ring-1 ring-black/10"
      style={{ left, top, width: POPUP_PHOTO_WIDTH, maxHeight: `calc(100vh - ${MARGIN * 2}px)` }}
    />
  );
}
