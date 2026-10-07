"use client";

import { ErrorBanner } from "@/components/ErrorBanner";
import type { Suggestion } from "@/lib/types";

export type SuggestionsStatus = "idle" | "loading" | "done" | "error";

type Props = {
  status: SuggestionsStatus;
  suggestions: Suggestion[];
  error: string | null;
  canSearch: boolean;
  onFind: () => void;
  onAccept: (s: Suggestion) => void;
  onDismiss: (osmId: string) => void;
  onDismissError: () => void;
  onHover?: (osmId: string | null) => void;
};

export function SuggestionsPanel({ status, suggestions, error, canSearch, onFind, onAccept, onDismiss, onDismissError, onHover }: Props) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Photo spot suggestions</h2>
        <button
          type="button"
          onClick={onFind}
          disabled={!canSearch || status === "loading"}
          className="rounded border px-3 py-1 text-sm"
        >
          {status === "loading" ? "Searching…" : "Find photo spots"}
        </button>
      </div>
      {!canSearch && <p className="text-xs text-gray-500">Suggestions need a route first.</p>}
      {status === "error" && error && (
        <div className="space-y-1">
          <ErrorBanner message={error} onDismiss={onDismissError} />
          <button type="button" onClick={onFind} className="text-sm underline">Retry</button>
        </div>
      )}
      {status === "done" && suggestions.length === 0 && (
        <p className="text-sm text-gray-500">No more suggestions along this route.</p>
      )}
      <ul className="space-y-2">
        {suggestions.map((s) => (
          <li key={s.osmId} data-testid="suggestion-card" onMouseEnter={() => onHover?.(s.osmId)} onMouseLeave={() => onHover?.(null)} onFocus={() => onHover?.(s.osmId)} onBlur={() => onHover?.(null)} className="flex items-center justify-between gap-2 rounded border p-2">
            <div>
              <p data-testid="suggestion-name" className="font-medium">{s.name}</p>
              <p className="text-xs capitalize text-gray-500">{s.kind}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => onAccept(s)} className="rounded bg-green-600 px-2 py-1 text-sm text-white">Accept</button>
              <button type="button" onClick={() => onDismiss(s.osmId)} className="rounded border px-2 py-1 text-sm">Dismiss</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
