import type { LngLat, Place, Stop } from "@/lib/types";

export type MapViewProps = {
  start: Place;
  end: Place;
  stops: Stop[];
  routeGeometry: LngLat[] | null;
  onMapClick: (p: { lat: number; lng: number }) => void;
  onStopClick: (stopId: string) => void;
};
