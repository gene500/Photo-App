"use client";

import { useEffect, useRef, useState } from "react";
import { bearingEndpoint } from "@/lib/geo";
import { fanOffsets } from "@/lib/marker-fan";
import { latLngToPercent, pixelToLatLng, type Bounds } from "@/lib/map-bounds";
import { loadPlacePhoto } from "@/lib/place-photo-cache";
import { STOP_MARKER_CLASS, stopColor } from "@/lib/stop-style";
import type { Suggestion } from "@/lib/types";
import type { MapViewProps } from "./map-types";
import { FLOW_TOTAL_MS } from "./route-flow";
import { ZOOM_FIT_LABEL, ZOOM_FIT_SVG } from "./zoom-fit";
import { isHoverPointer } from "./hover-pointer";
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
    const { osmId, name, lat, lng, kind, popularity } = suggestion;
    hostRef.current?.replaceChildren(
      createSuggestionPopupContent({ name, kind, popularity }, () => loadPlacePhoto({ key: osmId, name, lat, lng })),
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

/** Fixed hexes, like ROUTE_COLOR in MapPanel: a warm amber for sunrise, a violet for sunset. */
const SUNRISE_COLOR = "#d9822b";
const SUNSET_COLOR = "#7b4fa3";
const SKY_LINE_KM = 30;

/** No-network stand-in for Mapbox GL: used in e2e and when no token is configured. */
export function FakeMapPanel({ stops, routeGeometry, pending, suggestions = [], highlightedSuggestionId, selectedId, readOnly, sky, hikes, routeFlowId, onMapClick, onStopClick, onSuggestionClick, onCenterChange }: MapViewProps) {
  // The suggestion whose dot is hovered or focused; the panel's highlighted card also opens its popup.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // The fake viewport is fixed and already frames every stop, so "Zoom to fit" only counts the presses (e2e asserts on it).
  const [fitCount, setFitCount] = useState(0);
  useEffect(() => {
    onCenterChange?.({ lat: 37, lng: -119.5 });
  }, [onCenterChange]);

  // Water-flow after Optimize: "running" while the sweep plays, "done" after (at once with reduced motion, which draws no sweep).
  // The fake viewport is fixed and already frames every stop, so there is no zoom to do. Edits to the stops or route end it early.
  const hasRoute = (routeGeometry?.length ?? 0) >= 2;
  const sig = `${stops.map((s) => `${s.id}:${s.lat},${s.lng}`).join("|")}#${routeGeometry ? `${routeGeometry.length}:${routeGeometry[0]}:${routeGeometry[routeGeometry.length - 1]}` : ""}`;
  const [flowState, setFlowState] = useState<{ phase: "running" | "done" | null; handled: number; sig: string }>({ phase: null, handled: routeFlowId ?? 0, sig });
  let cur = flowState;
  if (cur.sig !== sig) {
    cur = { ...cur, sig, phase: cur.phase === "running" ? "done" : cur.phase };
    setFlowState(cur);
  }
  if (routeFlowId && routeFlowId !== cur.handled && hasRoute) {
    const reduced = typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    cur = { phase: reduced ? "done" : "running", handled: routeFlowId, sig };
    setFlowState(cur);
  }
  const flow = cur.phase;
  const flowRun = cur.handled;
  useEffect(() => {
    if (flow !== "running") return;
    const t = setTimeout(() => setFlowState((f) => (f.phase === "running" && f.handled === flowRun ? { ...f, phase: "done" } : f)), FLOW_TOTAL_MS);
    return () => clearTimeout(t);
  }, [flow, flowRun]);

  const bounds = FAKE_BOUNDS;
  const pos = (p: { lat: number; lng: number }) => latLngToPercent(bounds, p);
  const routePoints = (routeGeometry ?? [])
    .map(([lng, lat]) => pos({ lat, lng }))
    .map((p) => `${p.left},${p.top}`)
    .join(" ");

  const skyLines = sky
    ? ([["sunrise", sky.sunrise, SUNRISE_COLOR], ["sunset", sky.sunset, SUNSET_COLOR]] as const).flatMap(([name, bearing, color]) => {
        if (bearing === null) return [];
        const [lng, lat] = bearingEndpoint(sky, bearing, SKY_LINE_KM);
        const a = pos(sky);
        const b = pos({ lat, lng });
        // Arrowhead 45% of the way out, pointing back at the stop (the light travels from the sun to it).
        const ax = a.left + (b.left - a.left) * 0.45;
        const ay = a.top + (b.top - a.top) * 0.45;
        const len = Math.hypot(b.left - a.left, b.top - a.top) || 1;
        const ux = (a.left - b.left) / len;
        const uy = (a.top - b.top) / len;
        const tip = [ax + ux * 1.2, ay + uy * 1.2];
        const l = [ax - ux * 1.2 - uy * 1, ay - uy * 1.2 + ux * 1];
        const r = [ax - ux * 1.2 + uy * 1, ay - uy * 1.2 - ux * 1];
        return [{ name, bearing, color, points: `${a.left},${a.top} ${b.left},${b.top}`, arrow: `${tip} ${l} ${r}` }];
      })
    : [];

  // Display-only: stops whose markers overlap are fanned out (the fixed viewport is treated as 1000x600 px).
  const fan = fanOffsets(stops.map((s) => { const p = pos(s); return { id: s.id, x: p.left * 10, y: p.top * 6 }; }));

  const popupId = hoveredId ?? highlightedSuggestionId;
  const popupSuggestion = suggestions.find((s) => s.osmId === popupId);

  return (
    <div
      data-testid="map"
      data-route-flow={flow ?? undefined}
      data-fit-count={fitCount}
      className={`relative h-full min-h-[50vh] w-full overflow-hidden bg-[#d8d1bd] short-landscape:ml-[clamp(17.5rem,40%,23.75rem)] short-landscape:w-[calc(100%-clamp(17.5rem,40%,23.75rem))] ${readOnly ? "" : "cursor-crosshair"}`}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onMapClick(pixelToLatLng(bounds, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height));
      }}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {routePoints && <polyline data-testid="route-casing" points={routePoints} fill="none" stroke="#ffffff" strokeOpacity={0.85} strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" />}
        {routePoints && <polyline data-testid="route-line" points={routePoints} fill="none" stroke="#a8834b" strokeWidth={0.6} strokeLinecap="round" strokeLinejoin="round" />}
        {routePoints && flow === "running" && (
          <polyline key={flowRun} data-testid="route-flow" className="route-flow-line" points={routePoints} pathLength={100} fill="none" stroke="#8fd3f7" strokeOpacity={0.9} strokeWidth={0.9} strokeLinecap="round" strokeLinejoin="round" />
        )}
        {(hikes ?? []).filter((h) => h.geometry.length >= 2).map((h) => (
          <polyline key={h.id} data-testid="hike-line" data-stop-id={h.id} data-points={h.geometry.length}
            points={h.geometry.map(([lng, lat]) => pos({ lat, lng })).map((p) => `${p.left},${p.top}`).join(" ")}
            fill="none" stroke="#3f6b3a" strokeWidth={0.5} strokeDasharray="0.01 1.3" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {skyLines.map((l) => (
          <g key={l.name}>
            <polyline data-testid={`sky-line-${l.name}`} data-bearing={l.bearing} points={l.points} fill="none" stroke={l.color} strokeWidth={0.5} strokeDasharray="1.5 1" strokeLinecap="round" />
            <polygon data-testid={`sky-arrow-${l.name}`} points={l.arrow} fill={l.color} />
          </g>
        ))}
      </svg>
      {stops.map((s, i) => {
        const p = pos(s);
        const o = fan.get(s.id);
        return (
          <button
            key={s.id}
            type="button"
            aria-label={`Stop ${i + 1}: ${s.name}`}
            aria-pressed={s.id === selectedId}
            title={s.name}
            className={`map-marker absolute -translate-x-1/2 -translate-y-1/2 ${STOP_MARKER_CLASS} ${s.visited ? "text-black/75" : "text-white"} ${
              s.id === selectedId ? "ring-2 ring-route" : ""
            }`}
            style={{
              left: o ? `calc(${p.left}% + ${o.dx.toFixed(1)}px)` : `${p.left}%`,
              top: o ? `calc(${p.top}% + ${o.dy.toFixed(1)}px)` : `${p.top}%`,
              background: stopColor(s),
            }}
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
          className={`map-marker absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow ${
            s.osmId === highlightedSuggestionId ? "h-5 w-5 opacity-100" : "h-3.5 w-3.5 opacity-70"
          }`}
          style={{ left: `${pos(s).left}%`, top: `${pos(s).top}%` }}
          onPointerEnter={(e) => isHoverPointer(e) && setHoveredId(s.osmId)}
          onFocus={() => setHoveredId(s.osmId)}
          onPointerLeave={() => setHoveredId(null)}
          onBlur={() => setHoveredId(null)}
          onKeyDown={(e) => { if (e.key === "Escape") setHoveredId(null); }}
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
          role="img"
          aria-label="Selected place on the map"
          className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#3b3226] shadow-md"
          style={{ left: `${pos(pending).left}%`, top: `${pos(pending).top}%` }}
        />
      )}
      {stops.length > 0 && (
        <div className="zoom-fit-ctrl zoom-fit-fake" onClick={(e) => e.stopPropagation()}>
          <button type="button" aria-label={ZOOM_FIT_LABEL} title={ZOOM_FIT_LABEL} onClick={() => setFitCount((n) => n + 1)} dangerouslySetInnerHTML={{ __html: ZOOM_FIT_SVG }} />
        </div>
      )}
      <p className="absolute bottom-1 right-1 text-xs text-[#4a4538]">Offline map preview</p>
    </div>
  );
}
