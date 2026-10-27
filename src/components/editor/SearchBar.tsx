"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { api } from "@/lib/api-client";
import { card } from "@/components/ui/styles";
import { focusFirst, softDisabled } from "@/lib/focus";
import type { Place, SearchSuggestion } from "@/lib/types";
import { newSessionId } from "@/lib/session-id";
import { useDebouncedValue } from "@/lib/use-debounced-value";

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

type Props = {
  /** Read at search time so panning the map never re-triggers a search. */
  getProximity: () => { lat: number; lng: number } | null;
  onSelect: (place: Place) => void;
  /** Lets the editor move focus back to the box (after a card closes). */
  inputRef?: RefObject<HTMLInputElement | null>;
};

/** Results are tagged with the query that produced them so stale responses can't show. */
type Outcome = { query: string; suggestions: SearchSuggestion[]; error: string | null };

export function SearchBar({ getProximity, onSelect, inputRef }: Props) {
  const ownRef = useRef<HTMLInputElement>(null);
  const boxRef = inputRef ?? ownRef;
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const query = text.trim();
  // clear() bumps the nonce so retyping the same text within the debounce window still re-fetches.
  const [nonce, setNonce] = useState(0);
  const keyed = useDebouncedValue(`${nonce}|${query}`, DEBOUNCE_MS);
  const debounced = keyed.slice(keyed.indexOf("|") + 1);
  // One Mapbox search session: the suggests and the retrieve of a pick share it, then a pick starts the next one.
  const sessionRef = useRef<string | null>(null);
  sessionRef.current ??= newSessionId();
  // The suggestion being retrieved (buttons stay disabled meanwhile) and any failure of that retrieve.
  const [picking, setPicking] = useState<string | null>(null);
  const retrieving = useRef(false); // strict in-flight guard: state alone lets two clicks in one tick both through
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
    api.geocode(debounced, sessionRef.current ?? newSessionId(), getProximityRef.current() ?? undefined).then(
      (res) => {
        const suggestions = Array.isArray(res?.suggestions) ? res.suggestions : [];
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
  // The option the arrow keys are on (-1: none); the input keeps real focus and points at it with aria-activedescendant.
  const [active, setActive] = useState(-1);
  const options = shown?.suggestions ?? [];
  const activeIndex = active >= 0 && active < options.length ? active : -1;
  // Escape with the list open only closes it (the text stays); it opens again when the text changes. A second Escape clears.
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const listOpen = options.length > 0 && closedFor !== query;
  const message = pickError ?? shown?.error ?? "";

  function clear() {
    // A cleared search is a new one: the next suggests get a fresh Mapbox session.
    sessionRef.current = newSessionId();
    pickSeq.current++;
    retrieving.current = false;
    setText("");
    setOutcome(null);
    setPicking(null);
    setPickError(null);
    setActive(-1);
    setNonce((n) => n + 1);
  }

  function pick(s: SearchSuggestion) {
    if (retrieving.current) return;
    if (s.lat !== undefined && s.lng !== undefined) {
      onSelect({ name: s.name, lat: s.lat, lng: s.lng });
      clear();
      focusFirst(boxRef.current); // the result button is about to unmount
      return;
    }
    if (!s.mapboxId) return;
    const seq = ++pickSeq.current;
    retrieving.current = true;
    setPicking(s.mapboxId);
    setPickError(null);
    api.retrievePlace(s.mapboxId, sessionRef.current ?? newSessionId()).then(
      ({ place }) => {
        if (seq !== pickSeq.current) return;
        onSelect(place);
        clear();
        focusFirst(boxRef.current);
      },
      (e: unknown) => {
        if (seq !== pickSeq.current) return;
        retrieving.current = false;
        setPicking(null);
        setPickError(e instanceof Error ? e.message : "Couldn't load that place");
      },
    );
  }

  return (
    <div className="relative">
      <input
        ref={boxRef}
        role="combobox"
        aria-expanded={listOpen}
        aria-autocomplete="list"
        aria-controls={listOpen ? "place-search-results" : undefined}
        aria-activedescendant={listOpen && activeIndex >= 0 ? `place-option-${activeIndex}` : undefined}
        aria-label="Search for a place"
        autoComplete="off"
        maxLength={200}
        value={text}
        onChange={(e) => {
          pickSeq.current++;
          retrieving.current = false;
          setPicking(null);
          setPickError(null);
          setActive(-1);
          setClosedFor(null);
          if (e.target.value === "") sessionRef.current = newSessionId();
          setText(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (listOpen) setClosedFor(query);
            else clear();
          }
          else if (e.key === "ArrowDown" && !listOpen && options.length > 0) {
            // The list was closed with Escape: ArrowDown brings it back.
            e.preventDefault();
            setClosedFor(null);
            setActive(0);
          } else if (e.key === "ArrowDown" && listOpen) {
            e.preventDefault();
            setActive(activeIndex + 1 >= options.length ? 0 : activeIndex + 1);
          } else if (e.key === "ArrowUp" && listOpen) {
            e.preventDefault();
            setActive(activeIndex <= 0 ? options.length - 1 : activeIndex - 1);
          } else if (e.key === "Enter" && listOpen && activeIndex >= 0 && picking === null) {
            e.preventDefault();
            pick(options[activeIndex]!);
          }
        }}
        placeholder="Search for a place"
        className="w-full rounded-2xl bg-surface px-4 py-3 text-foreground placeholder:text-muted shadow-lg outline-none ring-1 ring-border focus:ring-2 focus:ring-accent-strong"
      />
      {/* Always mounted so "No matches found" and errors are announced when their text appears. */}
      <p role="status" className={message ? "mt-1 rounded-xl bg-surface px-3 py-2 text-sm text-danger shadow-lg" : "sr-only"}>{message}</p>
      {listOpen && (
        <ul id="place-search-results" role="listbox" aria-label="Search results" className={`mt-1 overflow-hidden rounded-xl py-1 ${card}`}>
          {options.map((p, i) => (
            <li
              key={p.mapboxId ?? `${p.lat},${p.lng},${p.name}`}
              id={`place-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              {...softDisabled(picking !== null)}
              onMouseDown={(e) => e.preventDefault()} // keep focus in the search box
              onClick={picking !== null ? undefined : () => pick(p)}
              aria-busy={picking !== null && picking === p.mapboxId}
              className={`min-h-10 w-full cursor-pointer px-4 py-2 text-left text-sm hover:bg-hover aria-disabled:opacity-60 ${i === activeIndex ? "bg-hover" : ""}`}
            >
              <span className="block break-words">{p.name}</span>
              {p.subtitle && <span className="block break-words text-xs text-muted">{p.subtitle}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
