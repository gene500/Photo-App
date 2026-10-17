"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { card } from "@/components/ui/styles";
import type { Place, SearchSuggestion } from "@/lib/types";
import { useDebouncedValue } from "@/lib/use-debounced-value";

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

type Props = {
  /** Read at search time so panning the map never re-triggers a search. */
  getProximity: () => { lat: number; lng: number } | null;
  onSelect: (place: Place) => void;
};

/** Results are tagged with the query that produced them so stale responses can't show. */
type Outcome = { query: string; suggestions: SearchSuggestion[]; error: string | null };

export function SearchBar({ getProximity, onSelect }: Props) {
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const query = text.trim();
  // clear() bumps the nonce so retyping the same text within the debounce window still re-fetches.
  const [nonce, setNonce] = useState(0);
  const keyed = useDebouncedValue(`${nonce}|${query}`, DEBOUNCE_MS);
  const debounced = keyed.slice(keyed.indexOf("|") + 1);
  // One Mapbox search session: the suggests and the retrieve of a pick share it, then a pick starts the next one.
  const sessionRef = useRef(crypto.randomUUID());
  // The suggestion being retrieved (buttons stay disabled meanwhile) and any failure of that retrieve.
  const [picking, setPicking] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  // Bumped whenever the text changes or is cleared, so a retrieve finishing after that is dropped.
  const pickSeq = useRef(0);
  const getProximityRef = useRef(getProximity);
  useEffect(() => {
    getProximityRef.current = getProximity;
  }, [getProximity]);

  useEffect(() => {
    if (debounced.length < MIN_CHARS) return;
    let cancelled = false;
    api.geocode(debounced, sessionRef.current, getProximityRef.current() ?? undefined).then(
      ({ suggestions }) => {
        if (!cancelled) setOutcome({ query: debounced, suggestions, error: suggestions.length === 0 ? "No matches found" : null });
      },
      (e: unknown) => {
        if (!cancelled) setOutcome({ query: debounced, suggestions: [], error: e instanceof Error ? e.message : "Search failed" });
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `keyed` carries the nonce; `debounced` derives from it
  }, [keyed]);

  const shown = query.length >= MIN_CHARS && outcome?.query === query ? outcome : null;

  function clear() {
    pickSeq.current++;
    setText("");
    setOutcome(null);
    setPicking(null);
    setPickError(null);
    setNonce((n) => n + 1);
  }

  function pick(s: SearchSuggestion) {
    if (picking) return;
    if (s.lat !== undefined && s.lng !== undefined) {
      onSelect({ name: s.name, lat: s.lat, lng: s.lng });
      clear();
      return;
    }
    if (!s.mapboxId) return;
    const seq = ++pickSeq.current;
    setPicking(s.mapboxId);
    setPickError(null);
    api.retrievePlace(s.mapboxId, sessionRef.current).then(
      ({ place }) => {
        if (seq !== pickSeq.current) return;
        sessionRef.current = crypto.randomUUID();
        onSelect(place);
        clear();
      },
      (e: unknown) => {
        if (seq !== pickSeq.current) return;
        setPicking(null);
        setPickError(e instanceof Error ? e.message : "Couldn't load that place");
      },
    );
  }

  return (
    <div className="relative">
      <input
        role="combobox"
        aria-expanded={Boolean(shown?.suggestions.length)}
        aria-controls="place-search-results"
        aria-label="Search for a place"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          pickSeq.current++;
          setPicking(null);
          setPickError(null);
          setText(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") clear();
        }}
        placeholder="Search for a place"
        className="w-full rounded-2xl bg-surface px-4 py-3 text-foreground placeholder:text-muted shadow-lg outline-none ring-1 ring-border focus:ring-2 focus:ring-accent-strong"
      />
      {(pickError ?? shown?.error) && (
        <p className="mt-1 rounded-xl bg-surface px-3 py-2 text-sm text-danger shadow-lg">{pickError ?? shown?.error}</p>
      )}
      {shown && shown.suggestions.length > 0 && (
        <ul id="place-search-results" className={`mt-1 overflow-hidden rounded-xl py-1 ${card}`}>
          {shown.suggestions.map((p) => (
            <li key={p.mapboxId ?? `${p.lat},${p.lng},${p.name}`}>
              <button
                type="button"
                disabled={picking !== null}
                aria-busy={picking !== null && picking === p.mapboxId}
                className="min-h-10 w-full px-4 py-2 text-left text-sm hover:bg-hover disabled:opacity-60"
                onClick={() => pick(p)}
              >
                <span className="block">{p.name}</span>
                {p.subtitle && <span className="block text-xs text-muted">{p.subtitle}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
