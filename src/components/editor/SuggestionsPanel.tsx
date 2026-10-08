"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { btnAccent, btnGhost, btnSecondary } from "@/components/ui/styles";
import { formatPhotoCount } from "@/lib/format";
import { isHoverPointer } from "./hover-pointer";
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
};

export function SuggestionsPanel({ status, suggestions, error, canSearch, onFind, onAccept, onDismiss, onDismissError, onHover }: Props) {
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
      if (before !== undefined && before !== top && typeof el.animate === "function" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        el.animate([{ transform: `translateY(${before - top}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
      }
    }
    tops.current = next;
  }, [suggestions]);
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
        {suggestions.map((s, i) => (
          <li key={s.osmId} data-testid="suggestion-card" data-id={s.osmId} style={{ animationDelay: `${(i % 5) * 50}ms` }} onPointerEnter={(e) => isHoverPointer(e) && onHover?.(s.osmId)} onPointerLeave={() => onHover?.(null)} onFocus={() => onHover?.(s.osmId)} onBlur={() => onHover?.(null)} className="anim-rise flex items-center justify-between gap-2 rounded-xl px-2 py-2 hover:bg-hover">
            <div className="min-w-0">
              <p data-testid="suggestion-name" className="truncate text-sm font-medium">{s.name}</p>
              <p className="text-xs text-muted">
                <span className="capitalize">{s.kind}</span>
                {formatPhotoCount(s.popularity) && <span data-testid="suggestion-popularity"> · {formatPhotoCount(s.popularity)}</span>}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button type="button" disabled={accepting.has(s.osmId)} onClick={() => void accept(s)} className={btnAccent}>Accept</button>
              <button type="button" onClick={() => onDismiss(s.osmId)} className={btnGhost}>Dismiss</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
