"use client";

import { boundsFor, latLngToPercent, pixelToLatLng } from "@/lib/map-bounds";
import { stopColor } from "@/lib/stop-style";
import type { MapViewProps } from "./map-types";

const DEFAULT_POINTS = [{ lat: 36, lng: -121 }, { lat: 38, lng: -118 }];

/** No-network stand-in for Mapbox GL: used in e2e and when no token is configured. */
export function FakeMapPanel({ stops, routeGeometry, onMapClick, onStopClick }: MapViewProps) {
  const bounds = boundsFor(stops.length ? stops : DEFAULT_POINTS);
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
      {stops.map((s) => {
        const p = pos(s);
        return (
          <button
            key={s.id}
            type="button"
            aria-label={`Stop ${s.name}`}
            title={s.name}
            className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white"
            style={{ left: `${p.left}%`, top: `${p.top}%`, background: stopColor(s) }}
            onClick={(e) => {
              e.stopPropagation();
              onStopClick(s.id);
            }}
          />
        );
      })}
      <p className="absolute bottom-1 left-1 text-xs text-gray-500">Offline map preview</p>
    </div>
  );
}
