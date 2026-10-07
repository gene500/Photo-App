"use client";

import { boundsFor, latLngToPercent, pixelToLatLng } from "@/lib/map-bounds";
import { stopColor } from "@/lib/stop-style";
import type { MapViewProps } from "./map-types";

/** No-network stand-in for Mapbox GL: used in e2e and when no token is configured. */
export function FakeMapPanel({ start, end, stops, routeGeometry, onMapClick, onStopClick }: MapViewProps) {
  const bounds = boundsFor([start, end]);
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
      <Dot at={pos(start)} color="#16a34a" label={`Start: ${start.name}`} />
      <Dot at={pos(end)} color="#dc2626" label={`End: ${end.name}`} />
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

function Dot({ at, color, label }: { at: { left: number; top: number }; color: string; label: string }) {
  return (
    <span
      aria-label={label}
      title={label}
      className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{ left: `${at.left}%`, top: `${at.top}%`, background: color }}
    />
  );
}
