import type { LngLat, Stop } from "@/lib/types";

export type MapViewProps = {
  stops: Stop[];
  routeGeometry: LngLat[] | null;
  onMapClick: (p: { lat: number; lng: number }) => void;
  onStopClick: (stopId: string) => void;
};
