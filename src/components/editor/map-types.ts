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
  /** Fly to a point; a new `nonce` re-triggers the move. */
  flyTo?: (LatLng & { nonce: number }) | null;
  onMapClick: (p: LatLng) => void;
  onStopClick: (stopId: string) => void;
  onStopMove?: (stopId: string, p: LatLng) => void;
  onSuggestionClick?: (osmId: string) => void;
  /** Called after the map settles (and once on load) with the current centre. */
  onCenterChange?: (p: LatLng) => void;
};
