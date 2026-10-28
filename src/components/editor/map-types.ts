import type { LngLat, Stop, Suggestion } from "@/lib/types";

export type LatLng = { lat: number; lng: number };

export type MapViewProps = {
  /** Public share view: markers cannot be dragged. */
  readOnly?: boolean;
  stops: Stop[];
  routeGeometry: LngLat[] | null;
  /** Temporary pin for a search result / clicked spot / suggestion being considered. */
  pending?: LatLng | null;
  suggestions?: Suggestion[];
  highlightedSuggestionId?: string | null;
  selectedId?: string | null;
  /** Fly to a point; a new `nonce` re-triggers the move. With `area` (a trip name's place) the map frames its box, and only if the viewer has not moved the map yet. */
  flyTo?: (LatLng & { nonce: number; area?: { bbox?: [number, number, number, number] } }) | null;
  /** The selected stop with its sunrise/sunset compass bearings (degrees clockwise from north); null draws no lines. */
  sky?: { lat: number; lng: number; sunrise: number | null; sunset: number | null } | null;
  /** Hike lines to draw (a dotted green line each, in their own map layer: never part of the route). Empty/absent: none. */
  hikes?: { id: string; geometry: LngLat[] }[];
  /** Counts up with every successful Optimize: a new value zooms out to show every stop, then runs the water-flow animation along the route. 0/absent: never. */
  routeFlowId?: number;
  /** The Edit stop drawer is open: the selected stop is re-centred clear of it. */
  drawerOpen?: boolean;
  onMapClick: (p: LatLng) => void;
  onStopClick: (stopId: string) => void;
  onStopMove?: (stopId: string, p: LatLng) => void;
  onSuggestionClick?: (osmId: string) => void;
  /** Called after the map settles (and once on load) with the current centre. */
  onCenterChange?: (p: LatLng) => void;
};
