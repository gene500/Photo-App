"use client";

import dynamic from "next/dynamic";
import { FakeMapPanel } from "./FakeMapPanel";
import type { MapViewProps } from "./map-types";

const MapPanel = dynamic(() => import("./MapPanel"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-muted">Loading map…</div>,
});

// Inlined at build time (NEXT_PUBLIC_*). Without a token the app stays usable via the offline preview.
const FAKE_MAP = process.env.NEXT_PUBLIC_MAP_FAKE === "1" || !process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export function MapView(props: MapViewProps) {
  return FAKE_MAP ? <FakeMapPanel {...props} /> : <MapPanel {...props} />;
}
