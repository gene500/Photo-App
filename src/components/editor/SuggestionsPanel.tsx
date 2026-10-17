"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { btnAccent, btnGhost, btnSecondary } from "@/components/ui/styles";
import { formatPhotoCount } from "@/lib/format";
import { isHoverPointer } from "./hover-pointer";
import { hasRoomBeside, SuggestionHoverPhoto } from "./SuggestionHoverPhoto";
import { weatherAriaLabel } from "@/lib/weather";
import type { WeatherLine } from "@/lib/use-weather";
import type { Suggestion } from "@/lib/types";

export type SuggestionsStatus = "idle" | "loading" | "done" | "error";

type Props = {
  status: SuggestionsStatus;
  suggestions: Suggestion[];
  error: string | null;
  canSearch: boolean;
  onFind: () => void;
  onAccept: (s: Suggestion) => void | Promise<void>;
  onDismiss: (osmId: string) => void;
  onDismissError: () => void;
  onHover?: (osmId: string | null) => void;
  /** Golden-hour weather per suggestion, filled in last (after the places and their ranking). */
  weather?: ReadonlyMap<string, WeatherLine>;
};

/** True for keyboard focus; a tap on a button also focuses it (on Android), and that must not pop the photo up. */
function keyboardFocus(el: HTMLElement): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

export function SuggestionsPanel({ status, suggestions, error, canSearch, onFind, onAccept, onDismiss, onDismissError, onHover, weather }: Props) {
  // Accepts in flight, per suggestion. The ref guards synchronously (two clicks can land
  // before a re-render); the state disables the button.
  const inFlight = useRef(new Set<string>());
  // Cards that move when popularity re-ranks the list slide to their new spot instead of jumping (FLIP).
  const listRef = useRef<HTMLUListElement>(null);
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    for (const el of listRef.current?.children ?? []) {
      const id = (el as HTMLElement).dataset.id;
      if (!id) continue;
      const top = (el as HTMLElement).offsetTop;
      next.set(id, top);
      const before = tops.current.get(id);
      if (before !== undefined && before !== top && typeof el.animate === "function" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches && document.documentElement.dataset.reduceMotion !== "true") {
        el.animate([{ transform: `translateY(${before - top}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
      }
    }
    tops.current = next;
  }, [suggestions]);
  const [hover, setHover] = useState<{ s: Suggestion; rect: DOMRect; order: string } | null>(null);
  // The card is positioned from where the row was when hovered, so any scroll or a removed row drops it.
  useEffect(() => {
    if (!hover) return;
    const clear = () => setHover(null);
    // Escape also drops the map dot's popup, which follows the same hover state.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { clear(); onHover?.(null); } };
    window.addEventListener("scroll", clear, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [hover, onHover]);
  // A re-rank or a changed list moves the rows, so a card anchored to the old layout is dropped (see `order` below).
  const order = suggestions.map((x) => x.osmId).join("|");
  const [accepting, setAccepting] = useState<ReadonlySet<string>>(new Set());
  async function accept(sug: Suggestion) {
    if (inFlight.current.has(sug.osmId)) return;
    inFlight.current.add(sug.osmId);
    setAccepting(new Set(inFlight.current));
    try {
      await onAccept(sug);
    } finally {
      inFlight.current.delete(sug.osmId);
      setAccepting(new Set(inFlight.current));
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Photo spot suggestions</h2>
        <button
          type="button"
          onClick={onFind}
          disabled={!canSearch || status === "loading"}
          className={btnSecondary}
        >
          {status === "loading" ? "Searching…" : "Find photo spots"}
        </button>
      </div>
      {!canSearch && <p className="text-xs text-muted">Suggestions need a route first.</p>}
      {status === "error" && error && (
        <div className="space-y-1">
          <ErrorBanner message={error} onDismiss={onDismissError} />
          <button type="button" onClick={onFind} className={btnGhost}>Retry</button>
        </div>
      )}
      {status === "done" && suggestions.length === 0 && (
        <p className="text-sm text-muted">No more suggestions along this route.</p>
      )}
      <ul ref={listRef} className="space-y-1">
        {suggestions.map((s, i) => {
          const line = weather?.get(s.osmId);
          return (
          <li key={s.osmId} data-testid="suggestion-card" data-id={s.osmId} style={{ animationDelay: `${(i % 5) * 50}ms` }} onPointerEnter={(e) => { if (isHoverPointer(e)) { onHover?.(s.osmId); const rect = e.currentTarget.getBoundingClientRect(); if (hasRoomBeside(rect)) setHover({ s, rect, order }); } }} onPointerLeave={() => { onHover?.(null); setHover(null); }} onFocus={(e) => { onHover?.(s.osmId); if (keyboardFocus(e.target as HTMLElement) && hasRoomBeside(e.currentTarget.getBoundingClientRect())) setHover({ s, rect: e.currentTarget.getBoundingClientRect(), order }); }} onBlur={() => { onHover?.(null); setHover(null); }} className="anim-rise flex items-center justify-between gap-2 rounded-xl px-2 py-2 hover:bg-hover">
            <div className="min-w-0">
              <p data-testid="suggestion-name" className="truncate text-sm font-medium">{s.name}</p>
              <p className="text-xs text-muted">
                <span className="capitalize">{s.kind}</span>
                {formatPhotoCount(s.popularity) && <span data-testid="suggestion-popularity"> · {formatPhotoCount(s.popularity)}</span>}
              </p>
              {line && (
                <p data-testid="suggestion-weather" data-light-quality={line.quality ?? undefined} title={line.label} className={`text-xs ${line.quality === "poor" ? "text-sand" : "text-muted"}`}>
                  <span role="img" aria-label={weatherAriaLabel(line)}>{line.text}</span>
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-1">
              <button type="button" disabled={accepting.has(s.osmId)} onClick={() => { setHover(null); void accept(s); }} className={btnAccent} aria-label={`Accept ${s.name}`}>Accept</button>
              <button type="button" onClick={() => { setHover(null); onDismiss(s.osmId); }} className={btnGhost} aria-label={`Dismiss ${s.name}`}>Dismiss</button>
            </div>
          </li>
          );
        })}
      </ul>
      {hover && hover.order === order && suggestions.some((x) => x.osmId === hover.s.osmId) && <SuggestionHoverPhoto suggestion={hover.s} anchor={hover.rect} />}
    </section>
  );
}
