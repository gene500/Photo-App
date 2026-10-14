"use client";

import { useEffect, useRef } from "react";
import { loadPlacePhoto } from "@/lib/place-photo-cache";
import type { Suggestion } from "@/lib/types";
import { createSuggestionPopupContent, POPUP_PHOTO_WIDTH } from "./suggestion-popup";

const GAP = 12;
const EST_HEIGHT = 230;

/** True when the card fits beside the row on at least one side; otherwise it would cover the row and its buttons. */
export function hasRoomBeside(anchor: DOMRect): boolean {
  const need = POPUP_PHOTO_WIDTH + GAP;
  return window.innerWidth - anchor.right >= need + GAP || anchor.left >= need + 8;
}

/** The photo card shown beside a suggestion in the list while it is hovered (the map dot has its own popup). */
export function SuggestionHoverPhoto({ suggestion, anchor }: { suggestion: Suggestion; anchor: DOMRect }) {
  const host = useRef<HTMLDivElement>(null);
  const { osmId, name, lat, lng } = suggestion;

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
  const top = Math.min(Math.max(8, anchor.top + anchor.height / 2 - EST_HEIGHT / 2), Math.max(8, window.innerHeight - EST_HEIGHT - 8));

  return (
    <div
      ref={host}
      data-testid="suggestion-hover-photo"
      aria-hidden
      className="pointer-events-none fixed z-50 overflow-hidden rounded-xl shadow-lg ring-1 ring-black/10"
      style={{ left, top, width: POPUP_PHOTO_WIDTH }}
    />
  );
}
