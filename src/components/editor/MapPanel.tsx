"use client";

import type { Feature, LineString } from "geojson";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { diffIds } from "@/lib/diff-ids";
import { wrapLng } from "@/lib/geo";
import { stopColor } from "@/lib/stop-style";
import type { LngLat } from "@/lib/types";
import type { MapViewProps } from "./map-types";

const ROUTE_SOURCE = "route";
const MARKER_CLASS = "map-marker";
const DEFAULT_CENTER: LngLat = [-98.5, 39.8];
const STOP_CLASS = "flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white shadow";
const PENDING_CLASS = "h-5 w-5 rounded-full border-2 border-white bg-red-600 shadow";

function routeData(geometry: LngLat[] | null): Feature<LineString> {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: geometry ?? [] } };
}

function markerElement(className: string, label: string, text = ""): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `${MARKER_CLASS} ${className}`;
  el.textContent = text;
  el.setAttribute("aria-label", label);
  el.title = label;
  return el;
}

// Keep fitted/flown-to points clear of what floats over the map: the bottom sheet on phones, the left card on desktop.
function viewPadding(): mapboxgl.PaddingOptions {
  const phone = typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
  return phone
    ? { top: 72, right: 24, left: 24, bottom: Math.round(window.innerHeight * 0.45) }
    : { top: 72, right: 64, bottom: 64, left: 400 };
}

export default function MapPanel({
  stops, routeGeometry, pending, suggestions = [], highlightedSuggestionId, selectedId, flyTo,
  onMapClick, onStopClick, onStopMove, onSuggestionClick, onCenterChange,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const stopMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const draggingRef = useRef<Set<string>>(new Set());
  const stopIdsRef = useRef<Set<string>>(new Set());
  const suggestionMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const pendingMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const handlersRef = useRef({ onMapClick, onStopClick, onStopMove, onSuggestionClick, onCenterChange });
  const initialRef = useRef({ center: (stops[0] ? [stops[0].lng, stops[0].lat] : DEFAULT_CENTER) as LngLat, zoom: stops.length ? 7 : 3.5 });
  const fittedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    handlersRef.current = { onMapClick, onStopClick, onStopMove, onSuggestionClick, onCenterChange };
  }, [onMapClick, onStopClick, onStopMove, onSuggestionClick, onCenterChange]);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      accessToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: initialRef.current.center,
      zoom: initialRef.current.zoom,
      attributionControl: false,
      logoPosition: "top-right",
    });
    // Top-right (offset below the search bar on phones, see globals.css) so the bottom sheet never covers them.
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "top-right");
    const reportCenter = () => {
      const c = map.getCenter();
      handlersRef.current.onCenterChange?.({ lat: c.lat, lng: wrapLng(c.lng) });
    };
    map.on("load", () => {
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: routeData(null) });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#2563eb", "line-width": 4 },
      });
      setLoaded(true);
      reportCenter();
    });
    map.on("moveend", reportCenter);
    map.on("click", (e) => {
      const target = e.originalEvent.target as HTMLElement | null;
      if (target?.closest(`.${MARKER_CLASS}`)) return; // marker clicks select, they don't drop pins
      handlersRef.current.onMapClick({ lat: e.lngLat.lat, lng: wrapLng(e.lngLat.lng) });
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Route line; fit the view the first time a route arrives.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource(ROUTE_SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData(routeData(routeGeometry));
    if (!fittedRef.current && routeGeometry && routeGeometry.length > 1) {
      const bounds = new mapboxgl.LngLatBounds(routeGeometry[0], routeGeometry[0]);
      for (const c of routeGeometry) bounds.extend(c);
      map.fitBounds(bounds, { padding: viewPadding(), duration: 0 });
      fittedRef.current = true;
    }
  }, [loaded, routeGeometry]);

  // Numbered, draggable stop markers, diffed by stop id so a state update never destroys a marker mid-drag.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = stopMarkersRef.current;
    stopIdsRef.current = new Set(stops.map((s) => s.id));
    const { add, keep, remove } = diffIds(markers.keys(), stops.map((s) => s.id));
    for (const id of remove) {
      if (draggingRef.current.has(id)) continue; // leave it alone until the drag ends
      markers.get(id)?.remove();
      markers.delete(id);
    }
    const addSet = new Set(add);
    const keepSet = new Set(keep);
    stops.forEach((s, i) => {
      const label = `Stop ${i + 1}: ${s.name}`;
      const selected = s.id === selectedId;
      if (keepSet.has(s.id)) {
        const marker = markers.get(s.id)!;
        if (draggingRef.current.has(s.id)) return;
        const el = marker.getElement();
        const ll = marker.getLngLat();
        if (ll.lng !== s.lng || ll.lat !== s.lat) marker.setLngLat([s.lng, s.lat]);
        if (el.textContent !== String(i + 1)) el.textContent = String(i + 1);
        // Toggle only our ring classes: mapbox owns the rest of the element's classes.
        el.classList.toggle("ring-2", selected);
        el.classList.toggle("ring-black", selected);
        el.style.background = stopColor(s);
        el.setAttribute("aria-label", label);
        el.title = label;
      } else if (addSet.has(s.id)) {
        const el = markerElement(`${STOP_CLASS} ${selected ? "ring-2 ring-black" : ""}`, label, String(i + 1));
        el.style.background = stopColor(s);
        const id = s.id;
        el.addEventListener("click", () => handlersRef.current.onStopClick(id));
        const marker = new mapboxgl.Marker({ element: el, draggable: true }).setLngLat([s.lng, s.lat]).addTo(map);
        marker.on("dragstart", () => draggingRef.current.add(id));
        marker.on("dragend", () => {
          draggingRef.current.delete(id);
          if (!stopIdsRef.current.has(id)) {
            // The stop was deleted mid-drag: the deferred removal never got another effect run.
            marker.remove();
            markers.delete(id);
            return;
          }
          const { lat, lng } = marker.getLngLat();
          handlersRef.current.onStopMove?.(id, { lat, lng: wrapLng(lng) });
        });
        markers.set(id, marker);
      }
    });
  }, [stops, selectedId]);

  // Remove all stop markers on unmount (the map teardown also drops them; this clears our bookkeeping).
  useEffect(() => {
    const markers = stopMarkersRef.current;
    return () => {
      for (const m of markers.values()) m.remove();
      markers.clear();
    };
  }, []);

  // Faint suggestion markers (bigger when highlighted from the panel).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of suggestionMarkersRef.current) m.remove();
    suggestionMarkersRef.current = suggestions.map((s) => {
      const big = s.osmId === highlightedSuggestionId;
      const el = markerElement(
        `rounded-full border border-white bg-amber-500 ${big ? "h-5 w-5" : "h-3.5 w-3.5 opacity-60"}`,
        `Suggestion: ${s.name}`,
      );
      el.addEventListener("click", () => handlersRef.current.onSuggestionClick?.(s.osmId));
      return new mapboxgl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map);
    });
  }, [suggestions, highlightedSuggestionId]);

  // The temporary pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    pendingMarkerRef.current?.remove();
    pendingMarkerRef.current = pending
      ? new mapboxgl.Marker({ element: markerElement(PENDING_CLASS, "Selected place") }).setLngLat([pending.lng, pending.lat]).addTo(map)
      : null;
  }, [pending]);

  // Fly to a requested point (new nonce = new request).
  const flyNonce = flyTo?.nonce;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: Math.max(map.getZoom(), 12), padding: viewPadding() });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the request nonce only
  }, [flyNonce]);

  // mapbox-gl.css sets `.mapboxgl-map { position: relative }` on the container, which beats Tailwind's
  // `absolute` and collapses it to zero height. The wrapper does the positioning; the container just fills it.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} data-testid="map" className="h-full w-full" />
    </div>
  );
}
