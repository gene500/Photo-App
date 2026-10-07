"use client";

import { useEffect } from "react";
import { latLngToPercent, pixelToLatLng, type Bounds } from "@/lib/map-bounds";
import { stopColor } from "@/lib/stop-style";
import type { MapViewProps } from "./map-types";

/**
 * Fixed viewport so fake geocoding (lat 36-38, lng -121..-118) always lands on screen
 * and e2e clicks map to stable coordinates.
 */
export const FAKE_BOUNDS: Bounds = { minLat: 36, maxLat: 38, minLng: -121, maxLng: -118 };

/** No-network stand-in for Mapbox GL: used in e2e and when no token is configured. */
export function FakeMapPanel({ stops, routeGeometry, pending, suggestions = [], highlightedSuggestionId, selectedId, onMapClick, onStopClick, onSuggestionClick, onCenterChange }: MapViewProps) {
  useEffect(() => {
    onCenterChange?.({ lat: 37, lng: -119.5 });
  }, [onCenterChange]);

  const bounds = FAKE_BOUNDS;
  const pos = (p: { lat: number; lng: number }) => latLngToPercent(bounds, p);
  const routePoints = (routeGeometry ?? [])
    .map(([lng, lat]) => pos({ lat, lng }))
    .map((p) => `${p.left},${p.top}`)
    .join(" ");

  return (
    <div
      data-testid="map"
      className="relative h-full min-h-[50vh] w-full cursor-crosshair overflow-hidden bg-emerald-50"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onMapClick(pixelToLatLng(bounds, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height));
      }}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {routePoints && <polyline points={routePoints} fill="none" stroke="#2563eb" strokeWidth={0.6} />}
      </svg>
      {stops.map((s, i) => {
        const p = pos(s);
        return (
          <button
            key={s.id}
            type="button"
            aria-label={`Stop ${i + 1}: ${s.name}`}
            title={s.name}
            className={`absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white shadow ${
              s.id === selectedId ? "ring-2 ring-black" : ""
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
          className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-amber-500 ${
            s.osmId === highlightedSuggestionId ? "h-5 w-5 opacity-100" : "h-3.5 w-3.5 opacity-60"
          }`}
          style={{ left: `${pos(s).left}%`, top: `${pos(s).top}%` }}
          onClick={(e) => {
            e.stopPropagation();
            onSuggestionClick?.(s.osmId);
          }}
        />
      ))}
      {pending && (
        <span
          aria-label="Selected place"
          className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-red-600 shadow"
          style={{ left: `${pos(pending).left}%`, top: `${pos(pending).top}%` }}
        />
      )}
      <p className="absolute bottom-1 right-1 text-xs text-gray-500">Offline map preview</p>
    </div>
  );
}
