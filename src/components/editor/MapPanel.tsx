"use client";

import type { Feature, LineString } from "geojson";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { stopColor } from "@/lib/stop-style";
import type { LngLat } from "@/lib/types";
import type { MapViewProps } from "./map-types";

const ROUTE_SOURCE = "route";
const MARKER_CLASS = "map-marker";

function routeData(geometry: LngLat[] | null): Feature<LineString> {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: geometry ?? [] } };
}

function markerElement(color: string, label: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `${MARKER_CLASS} h-4 w-4 rounded-full border-2 border-white shadow`;
  el.style.background = color;
  el.setAttribute("aria-label", label);
  el.title = label;
  return el;
}

export default function MapPanel({ start, end, stops, routeGeometry, onMapClick, onStopClick }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const handlersRef = useRef({ onMapClick, onStopClick });
  const initialCenterRef = useRef<LngLat>([start.lng, start.lat]);
  const fittedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    handlersRef.current = { onMapClick, onStopClick };
  }, [onMapClick, onStopClick]);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      accessToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: initialCenterRef.current,
      zoom: 7,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
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
    });
    map.on("click", (e) => {
      const target = e.originalEvent.target as HTMLElement | null;
      if (target?.closest(`.${MARKER_CLASS}`)) return; // marker clicks select, they don't drop pins
      handlersRef.current.onMapClick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
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
      map.fitBounds(bounds, { padding: 48, duration: 0 });
      fittedRef.current = true;
    }
  }, [loaded, routeGeometry]);

  // Start/end/stop markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of markersRef.current) m.remove();
    const markers = [
      new mapboxgl.Marker({ element: markerElement("#16a34a", `Start: ${start.name}`) }).setLngLat([start.lng, start.lat]),
      new mapboxgl.Marker({ element: markerElement("#dc2626", `End: ${end.name}`) }).setLngLat([end.lng, end.lat]),
      ...stops.map((s) => {
        const el = markerElement(stopColor(s), s.name);
        el.addEventListener("click", () => handlersRef.current.onStopClick(s.id));
        return new mapboxgl.Marker({ element: el }).setLngLat([s.lng, s.lat]);
      }),
    ];
    for (const m of markers) m.addTo(map);
    markersRef.current = markers;
  }, [start, end, stops]);

  return <div ref={containerRef} data-testid="map" className="absolute inset-0" />;
}
