"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import type { Place } from "@/lib/types";

type Props = { label: string; value: Place | null; onChange: (place: Place) => void; testId?: string };

export function PlaceSearch({ label, value, onChange, testId }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function search() {
    setLoading(true);
    setError(null);
    try {
      const { places } = await api.geocode(query.trim());
      setResults(places);
      if (places.length === 0) setError("No matches found");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <fieldset data-testid={testId} className="space-y-1">
      <legend className="text-sm font-medium">{label}</legend>
      {value && <p className="text-sm text-gray-700">Selected: {value.name}</p>}
      <div className="flex gap-2">
        <input
          aria-label={`${label} search`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
          placeholder="Search for a place"
          className="flex-1 rounded border px-2 py-1"
        />
        <button
          type="button"
          onClick={() => void search()}
          disabled={loading || query.trim().length < 2}
          className="rounded border px-3 py-1"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {results.length > 0 && (
        <ul className="rounded border">
          {results.map((p) => (
            <li key={`${p.lat},${p.lng},${p.name}`}>
              <button
                type="button"
                className="w-full px-2 py-1 text-left hover:bg-gray-100"
                onClick={() => {
                  onChange(p);
                  setResults([]);
                  setQuery("");
                }}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
