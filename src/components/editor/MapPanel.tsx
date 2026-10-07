"use client";

import type { Feature, LineString } from "geojson";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
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

export default function MapPanel({
  stops, routeGeometry, pending, suggestions = [], highlightedSuggestionId, selectedId, flyTo,
  onMapClick, onStopClick, onStopMove, onSuggestionClick, onCenterChange,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const stopMarkersRef = useRef<mapboxgl.Marker[]>([]);
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
    });
    map.addControl(new mapboxgl.NavigationControl(), "bottom-right");
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
      map.fitBounds(bounds, { padding: 64, duration: 0 });
      fittedRef.current = true;
    }
  }, [loaded, routeGeometry]);

  // Numbered, draggable stop markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of stopMarkersRef.current) m.remove();
    stopMarkersRef.current = stops.map((s, i) => {
      const el = markerElement(`${STOP_CLASS} ${s.id === selectedId ? "ring-2 ring-black" : ""}`, `Stop ${i + 1}: ${s.name}`, String(i + 1));
      el.style.background = stopColor(s);
      el.addEventListener("click", () => handlersRef.current.onStopClick(s.id));
      const marker = new mapboxgl.Marker({ element: el, draggable: true }).setLngLat([s.lng, s.lat]).addTo(map);
      marker.on("dragend", () => {
        const { lat, lng } = marker.getLngLat();
        handlersRef.current.onStopMove?.(s.id, { lat, lng: wrapLng(lng) });
      });
      return marker;
    });
  }, [stops, selectedId]);

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
    map.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: Math.max(map.getZoom(), 12) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the request nonce only
  }, [flyNonce]);

  return <div ref={containerRef} data-testid="map" className="absolute inset-0" />;
}
