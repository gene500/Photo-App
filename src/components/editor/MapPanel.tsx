"use client";

import type { Feature, FeatureCollection, LineString } from "geojson";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { diffIds } from "@/lib/diff-ids";
import { bearingEndpoint, wrapLng } from "@/lib/geo";
import { unwrapForFit } from "@/lib/map-bounds";
import { isMapFatalError, type MapErrorEvent } from "@/lib/map-errors";
import { useSettings } from "@/components/settings/SettingsProvider";
import { applyMapTheme } from "@/lib/map-theme";
import { loadPlacePhoto } from "@/lib/place-photo-cache";
import { isShortLandscape, sideViewPadding } from "@/lib/short-landscape";
import { SUNRISE_COLOR, SUNSET_COLOR } from "@/lib/sky";
import { decideFit, routeKey, selectionPadding, sheetBottomPadding } from "./map-fit";
import { fitMapToPoints, startRouteFlow } from "./route-flow-map";
import { fitTargets, ZoomFitControl } from "./zoom-fit";
import { casingLineWidth, firstLabelLayerId, routeLineWidth, simplifyBucket, simplifyRoute, simplifyToleranceDeg } from "./route-style";
import { fanOffsets } from "@/lib/marker-fan";
import { STOP_MARKER_CLASS, stopColor } from "@/lib/stop-style";
import type { LngLat, Suggestion } from "@/lib/types";
import type { MapViewProps } from "./map-types";
import { isHoverPointer } from "./hover-pointer";
import { ensureHikeLayer } from "./hike-layer";
import { createSuggestionPopupContent } from "./suggestion-popup";

const ROUTE_SOURCE = "route";
/** Mapbox paint can't read CSS variables; this is the light-theme `--route` token. */
const ROUTE_COLOR = "#a8834b"; // the light-theme --route token
const SKY_SOURCE = "sky";
/** The names live in their own source: if the glyph font fails to load, the lines and arrows still draw. */
const SKY_LABEL_SOURCE = "sky-labels";
/** The direction lines are this long on screen, whatever the zoom. */
const SKY_LINE_PX = 90;
const MARKER_CLASS = "map-marker";
const DEFAULT_CENTER: LngLat = [-98.5, 39.8];
// Visited markers are light, so they get dark numerals; the rest get white.
const textClass = (visited: boolean) => (visited ? "text-black/75" : "text-white");
/** A second click within this long is a double-click (a zoom), not a second pin. */
const DOUBLE_CLICK_MS = 280;
/** On touch screens the dot keeps its look but its tap area grows to 44px (an invisible ring around it). */
const TOUCH_HIT_DOT = "touch:before:absolute touch:before:-inset-[17px] touch:before:content-['']"; // 10px inside the border
const TOUCH_HIT_STOP = "touch:before:absolute touch:before:-inset-[9px] touch:before:content-['']"; // 26px inside the border
const PENDING_CLASS = "h-5 w-5 rounded-full border-2 border-white bg-[#3b3226] shadow-md";

/** Draws the route, smoothed to the map's current zoom so switchbacks and parallel roads don't clump when zoomed out. */
function drawRoute(map: mapboxgl.Map, geometry: LngLat[] | null, bucket: { current: number }) {
  bucket.current = simplifyBucket(map.getZoom());
  const line = geometry ? simplifyRoute(geometry, simplifyToleranceDeg(map.getZoom())) : null;
  (map.getSource(ROUTE_SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData(routeData(line));
}

function routeData(geometry: LngLat[] | null): Feature<LineString> {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: geometry ?? [] } };
}

const ARROW_FRACTION = 0.45;

/** A solid up-pointing arrowhead in `color`, registered as a map image so the sky layer can rotate it. */
function arrowImage(color: string): ImageData {
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.beginPath();
  ctx.moveTo(size / 2, 3);
  ctx.lineTo(size - 7, size - 6);
  ctx.lineTo(size / 2, size - 16);
  ctx.lineTo(7, size - 6);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  ctx.lineJoin = "round";
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

function emptySky(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

/** A line and a label point per known bearing, each SKY_LINE_PX long on screen at this zoom and latitude. */
function skyData(sky: MapViewProps["sky"], zoom: number): { lines: FeatureCollection; labels: FeatureCollection } {
  if (!sky) return { lines: emptySky(), labels: emptySky() };
  const km = (SKY_LINE_PX * 78271.51696 * Math.cos((sky.lat * Math.PI) / 180)) / 2 ** zoom / 1000;
  const features: Feature[] = [];
  const labels: Feature[] = [];
  for (const [kind, name, bearing] of [["sunrise", "Sunrise", sky.sunrise], ["sunset", "Sunset", sky.sunset]] as const) {
    if (bearing === null) continue;
    const end = bearingEndpoint(sky, bearing, km);
    // The arrowhead sits ARROW_FRACTION of the way out and points back at the stop: light travels from the sun to it.
    const arrowAt = bearingEndpoint(sky, bearing, km * ARROW_FRACTION);
    features.push(
      { type: "Feature", properties: { kind, arrow: true, rotation: (bearing + 180) % 360 }, geometry: { type: "Point", coordinates: arrowAt } },
      { type: "Feature", properties: { kind }, geometry: { type: "LineString", coordinates: [[sky.lng, sky.lat], end] } },
    );
    labels.push({ type: "Feature", properties: { kind, name }, geometry: { type: "Point", coordinates: end } });
  }
  return { lines: { type: "FeatureCollection", features }, labels: { type: "FeatureCollection", features: labels } };
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

/** The root font size relative to 16px (text size in Settings): the left card is rem-wide, so the padding must follow. */
function rootScale(): number {
  const px = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(px) && px > 0 ? px / 16 : 1;
}

// Keep fitted/flown-to points clear of what floats over the map: the bottom sheet on phones, the left card on desktop.
// The top clears the search bar that floats over the map plus a marker's radius (a stop at the edge was half hidden under it).
// The shared (read-only) page uses a taller sheet (55% of the height), so it needs more room below the points.
function viewPadding(readOnly = false): mapboxgl.PaddingOptions {
  // Short landscape: a side panel on the left and the whole height free, so frame the points in the map to its right.
  if (isShortLandscape()) return sideViewPadding(window.innerWidth, rootScale());
  const phone = typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
  return phone
    // Bottom adds a marker radius (the sheet's top edge would otherwise cut the lowest stop in half).
    // The sheet's real top edge is measured, so the full snap is cleared as well as the half one; right leaves room for the map controls column.
    ? { top: 96, right: 64, left: 24, bottom: sheetBottomPadding({ height: window.innerHeight, sheetTop: document.querySelector('[aria-label="Trip panel"]')?.getBoundingClientRect().top ?? null, readOnly, top: 96 }) }
    : { top: 112, right: 64, bottom: 64, left: Math.round(400 * rootScale()) };
}

/** The theme in effect now: the Settings override on <html>, else the OS preference. */
function isDarkNow(): boolean {
  const t = document.documentElement.getAttribute("data-theme");
  if (t) return t === "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export default function MapPanel({
  stops, routeGeometry, pending, suggestions = [], highlightedSuggestionId, selectedId, flyTo, readOnly, sky, hikes, drawerOpen, routeFlowId,
  onMapClick, onStopClick, onStopMove, onSuggestionClick, onCenterChange, onUnavailable,
}: MapViewProps & { onUnavailable?: () => void }) {
  const [tilesFailed, setTilesFailed] = useState(false);
  const failedRef = useRef(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { settings } = useSettings();
  // Read when the map is created: a change in Settings applies on the next load (the route layers are added once).
  const mapStyleRef = useRef(settings.mapStyle);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const userMovedRef = useRef(false);
  /** Zoom floor for the next stop re-centre: set by a fly-to so the list's zoom-in survives it. */
  /** A fly-to asks the selection re-centre (same commit) to keep its zoom-in; the request lapses after a second so a later marker click keeps the current zoom. */
  const minZoomRef = useRef({ zoom: 0, until: 0 });
  const stopMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const draggingRef = useRef<Set<string>>(new Set());
  const stopIdsRef = useRef<Set<string>>(new Set());
  const suggestionMarkersRef = useRef<mapboxgl.Marker[]>([]);
  // Suggestion dots already on the map, so only newly revealed ones fade in when the markers are rebuilt.
  const seenSuggestionsRef = useRef(new Set<string>());
  const pendingMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const routeGeometryRef = useRef(routeGeometry);
  const drawnBucketRef = useRef(NaN);
  const handlersRef = useRef({ onMapClick, onStopClick, onStopMove, onSuggestionClick, onCenterChange });
  const initialRef = useRef({ center: (stops[0] ? [stops[0].lng, stops[0].lat] : DEFAULT_CENTER) as LngLat, zoom: stops.length ? 7 : 3.5 });
  const fittedRef = useRef(false);
  const prevStopCountRef = useRef(0);
  const fittedRouteRef = useRef<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const flowRef = useRef<{ cancel: () => void } | null>(null);
  const zoomFitRef = useRef<ZoomFitControl | null>(null);
  const fitDataRef = useRef({ stops, routeGeometry, readOnly });
  /** The last Optimize run that was started (or dropped as stale), and when each new run id was first seen. */
  const flowHandledRef = useRef(routeFlowId ?? 0);
  const flowSeenRef = useRef({ id: routeFlowId ?? 0, at: 0 });
  const hikesRef = useRef(hikes);

  useEffect(() => {
    routeGeometryRef.current = routeGeometry;
  }, [routeGeometry]);
  useEffect(() => {
    fitDataRef.current = { stops, routeGeometry, readOnly };
    zoomFitRef.current?.setVisible(stops.length > 0);
  }, [stops, routeGeometry, readOnly]);
  useEffect(() => {
    handlersRef.current = { onMapClick, onStopClick, onStopMove, onSuggestionClick, onCenterChange };
  }, [onMapClick, onStopClick, onStopMove, onSuggestionClick, onCenterChange]);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    // No WebGL (old device, blocked GPU): hand over to the offline preview instead of taking the whole page down.
    let map: mapboxgl.Map;
    try {
      if (typeof mapboxgl.supported === "function" && !mapboxgl.supported()) throw new Error("WebGL unavailable");
      map = new mapboxgl.Map({
        container: containerRef.current,
        accessToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
        style: mapStyleRef.current === "standard" && isDarkNow() ? "mapbox://styles/mapbox/dark-v11" : "mapbox://styles/mapbox/light-v11",
        center: initialRef.current.center,
        zoom: initialRef.current.zoom,
        attributionControl: false,
        logoPosition: "top-right",
      });
    } catch {
      onUnavailable?.();
      return;
    }
    // A rejected token or failing tiles leave a blank map; say so once. Ordinary per-tile errors are ignored.
    // The notice clears when a tile does load (a later style swap or a recovered network).
    map.on("error", (e) => {
      if (isMapFatalError(e as unknown as MapErrorEvent)) { failedRef.current = true; setTilesFailed(true); }
    });
    map.on("data", (e) => {
      if (failedRef.current && (e as { dataType?: string; tile?: unknown }).dataType === "source" && (e as { tile?: unknown }).tile) {
        failedRef.current = false;
        setTilesFailed(false);
      }
    });
    // Top-right (offset below the search bar on phones, see globals.css) so the bottom sheet never covers them.
    // Set by a drag, scroll or pinch of the viewer's own (those events carry `originalEvent`), never by a flyTo.
    for (const type of ["dragstart", "zoomstart", "rotatestart"] as const) {
      map.on(type, (e) => { if ((e as { originalEvent?: unknown }).originalEvent) userMovedRef.current = true; });
    }
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "top-right");
    // Added last, so it stacks directly under the (i). Fits every stop and the route; never starts the Optimize animation.
    const zoomFit = new ZoomFitControl(() => {
      const { stops: s, routeGeometry: r, readOnly: ro } = fitDataRef.current;
      const points = unwrapForFit(fitTargets(s, r));
      if (points.length === 0) return;
      flowRef.current?.cancel();
      flowRef.current = null;
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      fitMapToPoints(map, points, viewPadding(ro), reduced ? { duration: 0 } : undefined);
    });
    zoomFit.setVisible(fitDataRef.current.stops.length > 0);
    zoomFitRef.current = zoomFit;
    map.addControl(zoomFit, "top-right");
    const reportCenter = () => {
      const c = map.getCenter();
      handlersRef.current.onCenterChange?.({ lat: c.lat, lng: wrapLng(c.lng) });
    };
    // Recolour the stock light style to the beige theme; `style.load` covers any later style swap.
    const theme = () => {
      if (mapStyleRef.current === "beige") applyMapTheme(map);
    };
    map.on("style.load", theme);
    map.on("load", () => {
      theme();
      // lineMetrics lets the Optimize water-flow highlight use a line-gradient along the route.
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: routeData(null), lineMetrics: true });
      // Under the style's labels, so road and place names stay readable over the line.
      const belowLabels = firstLabelLayerId(map.getStyle()?.layers);
      // A slightly wider white line underneath gives the route a soft casing on the pale map.
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": casingLineWidth() as mapboxgl.Expression, "line-opacity": 0.9 },
      }, belowLabels);
      map.addLayer({
        id: "route-line",
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ROUTE_COLOR, "line-width": routeLineWidth() as mapboxgl.Expression },
      }, belowLabels);
      // Sunrise/sunset direction lines for the selected stop (data is set by the sky effect).
      map.addSource(SKY_SOURCE, { type: "geojson", data: emptySky() });
      for (const [kind, color] of [["sunrise", SUNRISE_COLOR], ["sunset", SUNSET_COLOR]] as const) {
        map.addLayer({
          id: `sky-${kind}`,
          type: "line",
          source: SKY_SOURCE,
          filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "kind"], kind]],
          layout: { "line-cap": "round" },
          paint: { "line-color": color, "line-width": 3, "line-dasharray": [2, 1.5] },
        });
      }
      for (const [kind, color] of [["sunrise", SUNRISE_COLOR], ["sunset", SUNSET_COLOR]] as const) {
        map.addImage(`sky-arrow-${kind}`, arrowImage(color), { pixelRatio: 2 });
        map.addLayer({
          id: `sky-arrow-${kind}`,
          type: "symbol",
          source: SKY_SOURCE,
          filter: ["all", ["==", ["get", "arrow"], true], ["==", ["get", "kind"], kind]],
          layout: {
            "icon-image": `sky-arrow-${kind}`,
            "icon-rotate": ["get", "rotation"],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        });
      }
      map.addSource(SKY_LABEL_SOURCE, { type: "geojson", data: emptySky() });
      map.addLayer({
        id: "sky-names",
        type: "symbol",
        source: SKY_LABEL_SOURCE,
        filter: ["has", "name"],
        layout: {
          "text-field": ["get", "name"],
          // The stock light/dark styles serve these glyph ranges.
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
          "text-size": 12,
          "text-offset": [0, -1],
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": ["match", ["get", "kind"], "sunrise", SUNRISE_COLOR, SUNSET_COLOR],
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });
      ensureHikeLayer(map, hikesRef.current);
      setLoaded(true);
      reportCenter();
    });
    // Rotating or resizing re-frames the stops, unless the viewer has moved the map themselves.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const { stops: s, routeGeometry: r, readOnly: ro } = fitDataRef.current;
        if (userMovedRef.current || !fittedRef.current || flowRef.current || s.length === 0) return;
        fitMapToPoints(map, unwrapForFit(fitTargets(s, r)), viewPadding(ro), { duration: 0 });
      }, 200);
    };
    window.addEventListener("resize", onResize);
    map.on("remove", () => { clearTimeout(resizeTimer); window.removeEventListener("resize", onResize); });
    map.on("moveend", reportCenter);
    // Redraw the (zoom-smoothed) route when the zoom level changes; the saved geometry is never altered.
    map.on("zoomend", () => {
      if (simplifyBucket(map.getZoom()) !== drawnBucketRef.current) drawRoute(map, routeGeometryRef.current, drawnBucketRef);
    });
    map.on("click", (e) => {
      const target = e.originalEvent.target as HTMLElement | null;
      if (target?.closest(`.${MARKER_CLASS}`)) return; // marker clicks select, they don't drop pins
      // A double-click/tap zooms: the pin waits a moment and is dropped only if no second click follows.
      const at = { lat: e.lngLat.lat, lng: wrapLng(e.lngLat.lng) };
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = setTimeout(() => { clickTimerRef.current = null; handlersRef.current.onMapClick(at); }, DOUBLE_CLICK_MS);
    });
    map.on("dblclick", () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    });
    mapRef.current = map;
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      popupRef.current?.remove();
      popupRef.current = null;
      flowRef.current?.cancel();
      flowRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // Created once; onUnavailable is only used at creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Route line; fit the view the first time a route arrives.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    drawRoute(map, routeGeometry, drawnBucketRef);
    const key = routeKey(routeGeometry);
    const fit = decideFit({ prevCount: prevStopCountRef.current, count: stops.length, route: key, fittedRoute: fittedRouteRef.current, fitted: fittedRef.current });
    if (fit) {
      // A route frames itself; without one (before Optimize) the stops are framed.
      const points: LngLat[] = unwrapForFit(fit === "route" ? routeGeometry! : stops.map((s): LngLat => [s.lng, s.lat]));
      const bounds = new mapboxgl.LngLatBounds(points[0], points[0]);
      for (const c of points) bounds.extend(c);
      map.fitBounds(bounds, { padding: viewPadding(readOnly), duration: 0, maxZoom: 14 }); // stops almost on top of each other would otherwise zoom to the maximum
      fittedRef.current = true;
    }
    // Forgotten while no route is drawn, so the same route coming back (Undo) is framed again.
    fittedRouteRef.current = fit === "route" ? key : key === null ? null : fittedRouteRef.current;
    prevStopCountRef.current = stops.length;
    // Only the stop count matters here (not their positions), so a drag does not reframe the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, routeGeometry, readOnly, stops.length]);

  // A running water flow is dropped as soon as the stops or the route change under it (an edit, Undo, another Optimize).
  const stopsSig = stops.map((s) => `${s.id}:${s.lat},${s.lng}`).join("|");
  const flowRouteKey = routeKey(routeGeometry);
  useEffect(() => {
    return () => {
      flowRef.current?.cancel();
      flowRef.current = null;
    };
  }, [stopsSig, flowRouteKey]);

  // After a successful Optimize: show every stop, wait for that move to end, then run the water along the route.
  // Waits for the route if it has not arrived yet; a run id that never found a route within 10 s is dropped.
  useEffect(() => {
    const map = mapRef.current;
    const id = routeFlowId ?? 0;
    if (!map || !loaded || !id || id === flowHandledRef.current) return;
    if (flowSeenRef.current.id !== id) flowSeenRef.current = { id, at: Date.now() };
    if (!routeGeometry || routeGeometry.length < 2) {
      if (Date.now() - flowSeenRef.current.at > 10_000) flowHandledRef.current = id;
      return;
    }
    flowHandledRef.current = id;
    flowRef.current?.cancel();
    const points: LngLat[] = unwrapForFit([...stops.map((s): LngLat => [s.lng, s.lat]), ...routeGeometry]);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const run = startRouteFlow(map, {
      points,
      padding: viewPadding(readOnly),
      reducedMotion,
      source: ROUTE_SOURCE,
      hideLayers: ["route-casing", "route-line"],
      // Just above the route, under the labels (like the route itself); the sky layers if the style has no labels.
      beforeId: firstLabelLayerId(map.getStyle()?.layers) ?? (map.getLayer("sky-sunrise") ? "sky-sunrise" : undefined),
      onEnd: () => { if (flowRef.current === run) flowRef.current = null; },
    });
    flowRef.current = run;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- starts per run id (or when the route arrives), not on stop edits
  }, [loaded, routeFlowId, routeGeometry]);

  // Hike lines (the selected stop's and toggled-on ones): a separate dotted layer, never the route. Emptied when there are none, and put back if a style reload dropped it.
  useEffect(() => {
    hikesRef.current = hikes;
    const map = mapRef.current;
    if (!map || !loaded) return;
    const apply = () => ensureHikeLayer(map, hikesRef.current);
    apply();
    map.on("style.load", apply);
    return () => {
      map.off("style.load", apply);
    };
  }, [loaded, hikes]);

  // Sunrise/sunset lines for the selected stop; redrawn after each zoom so they stay SKY_LINE_PX long.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const update = () => {
      const data = skyData(sky, map.getZoom());
      (map.getSource(SKY_SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData(data.lines);
      (map.getSource(SKY_LABEL_SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData(data.labels);
    };
    update();
    map.on("zoomend", update);
    return () => {
      map.off("zoomend", update);
    };
  }, [loaded, sky]);

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
        el.classList.toggle("ring-route", selected);
        el.classList.toggle("text-black/75", s.visited);
        el.classList.toggle("text-white", !s.visited);
        el.style.background = stopColor(s);
        el.setAttribute("aria-label", label);
        el.setAttribute("aria-pressed", String(selected));
        el.setAttribute("role", "button"); // Mapbox sets role=img on markers, which would drop the button semantics
        el.title = label;
      } else if (addSet.has(s.id)) {
        const el = markerElement(`${STOP_MARKER_CLASS} ${TOUCH_HIT_STOP} ${textClass(s.visited)} ${selected ? "ring-2 ring-route" : ""}`, label, String(i + 1));
        el.style.background = stopColor(s);
        el.setAttribute("aria-pressed", String(selected));
        const id = s.id;
        el.addEventListener("click", () => handlersRef.current.onStopClick(id));
        const marker = new mapboxgl.Marker({ element: el, draggable: !readOnly }).setLngLat([s.lng, s.lat]).addTo(map);
        el.setAttribute("role", "button");
        marker.on("dragstart", () => draggingRef.current.add(id));
        marker.on("dragend", () => {
          draggingRef.current.delete(id);
          if (!stopIdsRef.current.has(id)) {
            // The stop was deleted mid-drag: the deferred removal never got another effect run.
            marker.remove();
            markers.delete(id);
            return;
          }
          // A fanned marker is drawn at its true point plus the fan offset, but Mapbox drags from the true point: the
          // spot the owner dropped it on is the drawn one.
          const { x: ox, y: oy } = marker.getOffset();
          const { lat, lng } = map.unproject(map.project(marker.getLngLat()).add(new mapboxgl.Point(ox, oy)));
          marker.setLngLat([lng, lat]).setOffset([0, 0]);
          handlersRef.current.onStopMove?.(id, { lat, lng: wrapLng(lng) });
        });
        markers.set(id, marker);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- readOnly is fixed for the life of the map
  }, [stops, selectedId]);

  // Display-only: fan out stop markers that overlap on screen at the current zoom (stored coordinates are untouched).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      const markers = stopMarkersRef.current;
      const pts = stops.filter((s) => markers.has(s.id)).map((s) => {
        const p = map.project([s.lng, s.lat]);
        return { id: s.id, x: p.x, y: p.y };
      });
      const fan = fanOffsets(pts);
      for (const [id, m] of markers) {
        if (draggingRef.current.has(id)) continue;
        const o = fan.get(id);
        m.setOffset(o ? [o.dx, o.dy] : [0, 0]);
      }
    };
    update();
    map.on("zoomend", update);
    return () => {
      map.off("zoomend", update);
    };
  }, [stops, loaded]);

  // Remove all stop markers on unmount (the map teardown also drops them; this clears our bookkeeping).
  useEffect(() => {
    const markers = stopMarkersRef.current;
    return () => {
      for (const m of markers.values()) m.remove();
      markers.clear();
    };
  }, []);

  // Faint suggestion markers (bigger when highlighted from the panel). Hovering/focusing one shows a photo popup
  // (the panel card has its own, beside the list); only one popup exists at a time.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const hidePopup = () => {
      popupRef.current?.remove();
      popupRef.current = null;
    };
    const showPopup = (s: Suggestion) => {
      hidePopup();
      const content = createSuggestionPopupContent(s, () => loadPlacePhoto({ key: s.osmId, name: s.name, lat: s.lat, lng: s.lng }));
      popupRef.current = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, closeOnMove: false, offset: 14, maxWidth: "220px", className: "suggestion-popup" })
        .setLngLat([s.lng, s.lat])
        .setDOMContent(content)
        .addTo(map);
    };
    hidePopup(); // the markers below are rebuilt, so any open popup's dot is gone
    for (const m of suggestionMarkersRef.current) m.remove();
    if (suggestions.length === 0) seenSuggestionsRef.current.clear();
    let fresh = 0;
    suggestionMarkersRef.current = suggestions.map((s) => {
      const isNew = !seenSuggestionsRef.current.has(s.osmId);
      seenSuggestionsRef.current.add(s.osmId);
      const big = s.osmId === highlightedSuggestionId;
      const el = markerElement(
        `${TOUCH_HIT_DOT} rounded-full border-2 border-white bg-accent shadow ${big ? "h-5 w-5" : "h-3.5 w-3.5 opacity-70"}`,
        `Suggestion: ${s.name}`,
      );
      if (isNew) {
        el.classList.add("anim-dot-in");
        el.style.animationDelay = `${Math.min(fresh++, 10) * 45}ms`;
      }
      el.addEventListener("click", () => {
        hidePopup(); // touch has no mouseleave; the place card shows the photo from here
        handlersRef.current.onSuggestionClick?.(s.osmId);
      });
      // Pointer events, ignoring touch: a hover-added popup makes iOS WebKit swallow the tap's click.
      el.addEventListener("pointerenter", (e) => isHoverPointer(e) && showPopup(s));
      el.addEventListener("focus", () => showPopup(s));
      el.addEventListener("keydown", (e) => { if (e.key === "Escape") hidePopup(); });
      el.addEventListener("pointerleave", hidePopup);
      el.addEventListener("blur", hidePopup);
      return new mapboxgl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map);
    });
  }, [suggestions, highlightedSuggestionId]);

  // The temporary pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    pendingMarkerRef.current?.remove();
    pendingMarkerRef.current = pending
      ? new mapboxgl.Marker({ element: markerElement(PENDING_CLASS, "Selected place on the map") }).setLngLat([pending.lng, pending.lat]).addTo(map)
      : null;
  }, [pending]);

  // Fly to a requested point (new nonce = new request).
  const flyNonce = flyTo?.nonce;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    if (flyTo.area) {
      // A trip name's place only replaces the world view; it never undoes where the viewer has moved to.
      if (userMovedRef.current) return;
      const b = flyTo.area.bbox;
      if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: viewPadding(readOnly), maxZoom: 11 });
      else map.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: 10, padding: viewPadding(readOnly) });
      return;
    }
    minZoomRef.current = { zoom: 12, until: Date.now() + 1000 };
    map.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: Math.max(map.getZoom(), 12), padding: viewPadding(readOnly) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the request nonce only
  }, [flyNonce]);

  // Selecting a stop (or opening/closing its drawer) centres it, and the arrows around it, in the uncovered part of the map.
  // Runs after the fly-to effect so a stop opened from the list keeps that zoom-in; a plain marker click keeps the zoom.
  const skyLat = sky?.lat;
  const skyLng = sky?.lng;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || skyLat === undefined || skyLng === undefined) return;
    const phone = window.matchMedia("(max-width: 1023px)").matches;
    const drawer = phone ? null : document.querySelector<HTMLElement>('[role="dialog"][aria-label^="Edit "]');
    map.easeTo({
      center: [skyLng, skyLat],
      zoom: Math.max(map.getZoom(), Date.now() <= minZoomRef.current.until ? minZoomRef.current.zoom : 0),
      padding: selectionPadding(viewPadding(readOnly), drawer?.offsetWidth ?? 0),
    });
    minZoomRef.current = { zoom: 0, until: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-centre per selected stop and drawer state only
  }, [loaded, skyLat, skyLng, drawerOpen]);

  // mapbox-gl.css sets `.mapboxgl-map { position: relative }` on the container, which beats Tailwind's
  // `absolute` and collapses it to zero height. The wrapper does the positioning; the container just fills it.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} data-testid="map" className="h-full w-full" />
      {tilesFailed && (
        <p role="status" className="pointer-events-none absolute left-1/2 top-[4.5rem] z-10 max-w-[calc(100%-6rem)] -translate-x-1/2 rounded-full bg-surface px-3 py-1 text-center text-xs text-muted shadow ring-1 ring-border lg:bottom-3 lg:top-auto">
          Map tiles could not be loaded.
        </p>
      )}
    </div>
  );
}
