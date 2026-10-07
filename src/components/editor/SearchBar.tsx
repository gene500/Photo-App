"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { card } from "@/components/ui/styles";
import type { Place } from "@/lib/types";
import { useDebouncedValue } from "@/lib/use-debounced-value";

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

type Props = {
  /** Read at search time so panning the map never re-triggers a search. */
  getProximity: () => { lat: number; lng: number } | null;
  onSelect: (place: Place) => void;
};

/** Results are tagged with the query that produced them so stale responses can't show. */
type Outcome = { query: string; places: Place[]; error: string | null };

export function SearchBar({ getProximity, onSelect }: Props) {
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const query = text.trim();
  // clear() bumps the nonce so retyping the same text within the debounce window still re-fetches.
  const [nonce, setNonce] = useState(0);
  const keyed = useDebouncedValue(`${nonce}|${query}`, DEBOUNCE_MS);
  const debounced = keyed.slice(keyed.indexOf("|") + 1);
  const getProximityRef = useRef(getProximity);
  useEffect(() => {
    getProximityRef.current = getProximity;
  }, [getProximity]);

  useEffect(() => {
    if (debounced.length < MIN_CHARS) return;
    let cancelled = false;
    api.geocode(debounced, getProximityRef.current() ?? undefined).then(
      ({ places }) => {
        if (!cancelled) setOutcome({ query: debounced, places, error: places.length === 0 ? "No matches found" : null });
      },
      (e: unknown) => {
        if (!cancelled) setOutcome({ query: debounced, places: [], error: e instanceof Error ? e.message : "Search failed" });
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `keyed` carries the nonce; `debounced` derives from it
  }, [keyed]);

  const shown = query.length >= MIN_CHARS && outcome?.query === query ? outcome : null;

  function clear() {
    setText("");
    setOutcome(null);
    setNonce((n) => n + 1);
  }

  return (
    <div className="relative">
      <input
        role="combobox"
        aria-expanded={Boolean(shown?.places.length)}
        aria-controls="place-search-results"
        aria-label="Search for a place"
        autoComplete="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") clear();
        }}
        placeholder="Search for a place"
        className="w-full rounded-2xl bg-surface px-4 py-3 text-foreground placeholder:text-muted shadow-lg outline-none ring-1 ring-border focus:ring-2 focus:ring-accent-strong"
      />
      {shown?.error && <p className="mt-1 rounded-xl bg-surface px-3 py-2 text-sm text-danger shadow-lg">{shown.error}</p>}
      {shown && shown.places.length > 0 && (
        <ul id="place-search-results" className={`mt-1 overflow-hidden rounded-xl py-1 ${card}`}>
          {shown.places.map((p) => (
            <li key={`${p.lat},${p.lng},${p.name}`}>
              <button
                type="button"
                className="min-h-10 w-full px-4 py-2 text-left text-sm hover:bg-hover"
                onClick={() => {
                  onSelect(p);
                  clear();
                }}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
