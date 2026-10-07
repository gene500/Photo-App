"use client";

import { useEffect, useRef, useState } from "react";
import { latLngToPercent, pixelToLatLng, type Bounds } from "@/lib/map-bounds";
import { loadPlacePhoto } from "@/lib/place-photo-cache";
import { stopColor } from "@/lib/stop-style";
import type { Suggestion } from "@/lib/types";
import type { MapViewProps } from "./map-types";
import { createSuggestionPopupContent } from "./suggestion-popup";

/**
 * Fixed viewport so fake geocoding (lat 36-38, lng -121..-118) always lands on screen
 * and e2e clicks map to stable coordinates.
 */
export const FAKE_BOUNDS: Bounds = { minLat: 36, maxLat: 38, minLng: -121, maxLng: -118 };

/** Mounts the same DOM popup body the real map uses, so e2e exercises the real content builder. */
function SuggestionPopup({ suggestion, left, top }: { suggestion: Suggestion; left: number; top: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const { osmId, name, lat, lng, kind } = suggestion;
    hostRef.current?.replaceChildren(
      createSuggestionPopupContent({ name, kind }, () => loadPlacePhoto({ key: osmId, name, lat, lng })),
    );
  }, [suggestion]);
  return (
    <div
      ref={hostRef}
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full overflow-hidden rounded-xl shadow-lg ring-1 ring-border"
      style={{ left: `${left}%`, top: `calc(${top}% - 14px)` }}
    />
  );
}

/** No-network stand-in for Mapbox GL: used in e2e and when no token is configured. */
export function FakeMapPanel({ stops, routeGeometry, pending, suggestions = [], highlightedSuggestionId, selectedId, onMapClick, onStopClick, onSuggestionClick, onCenterChange }: MapViewProps) {
  // The suggestion whose dot is hovered or focused; the panel's highlighted card also opens its popup.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  useEffect(() => {
    onCenterChange?.({ lat: 37, lng: -119.5 });
  }, [onCenterChange]);

  const bounds = FAKE_BOUNDS;
  const pos = (p: { lat: number; lng: number }) => latLngToPercent(bounds, p);
  const routePoints = (routeGeometry ?? [])
    .map(([lng, lat]) => pos({ lat, lng }))
    .map((p) => `${p.left},${p.top}`)
    .join(" ");

  const popupId = hoveredId ?? highlightedSuggestionId;
  const popupSuggestion = suggestions.find((s) => s.osmId === popupId);

  return (
    <div
      data-testid="map"
      className="relative h-full min-h-[50vh] w-full cursor-crosshair overflow-hidden bg-[#eceae6]"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onMapClick(pixelToLatLng(bounds, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height));
      }}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {routePoints && <polyline points={routePoints} fill="none" stroke="#b08d57" strokeWidth={0.6} strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
      {stops.map((s, i) => {
        const p = pos(s);
        return (
          <button
            key={s.id}
            type="button"
            aria-label={`Stop ${i + 1}: ${s.name}`}
            title={s.name}
            className={`absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-semibold shadow-md ${s.visited ? "text-black/75" : "text-white"} ${
              s.id === selectedId ? "ring-2 ring-route" : ""
            }`}
            style={{ left: `${p.left}%`, top: `${p.top}%`, background: stopColor(s) }}
            onClick={(e) => {
              e.stopPropagation();
              onStopClick(s.id);
            }}
          >
            {i + 1}
          </button>
        );
      })}
      {suggestions.map((s) => (
        <button
          key={s.osmId}
          type="button"
          aria-label={`Suggestion: ${s.name}`}
          title={s.name}
          className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow ${
            s.osmId === highlightedSuggestionId ? "h-5 w-5 opacity-100" : "h-3.5 w-3.5 opacity-70"
          }`}
          style={{ left: `${pos(s).left}%`, top: `${pos(s).top}%` }}
          onMouseEnter={() => setHoveredId(s.osmId)}
          onFocus={() => setHoveredId(s.osmId)}
          onMouseLeave={() => setHoveredId(null)}
          onBlur={() => setHoveredId(null)}
          onClick={(e) => {
            e.stopPropagation();
            setHoveredId(null);
            onSuggestionClick?.(s.osmId);
          }}
        />
      ))}
      {popupSuggestion && <SuggestionPopup suggestion={popupSuggestion} left={pos(popupSuggestion).left} top={pos(popupSuggestion).top} />}
      {pending && (
        <span
          aria-label="Selected place"
          className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#3b3226] shadow-md"
          style={{ left: `${pos(pending).left}%`, top: `${pos(pending).top}%` }}
        />
      )}
      <p className="absolute bottom-1 right-1 text-xs text-muted">Offline map preview</p>
    </div>
  );
}
