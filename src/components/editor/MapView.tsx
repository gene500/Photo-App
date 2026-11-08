"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { FakeMapPanel } from "./FakeMapPanel";
import type { MapViewProps } from "./map-types";

const MapPanel = dynamic(() => import("./MapPanel"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-muted">Loading map…</div>,
});

// Inlined at build time (NEXT_PUBLIC_*). Without a token the app stays usable via the offline preview.
const FAKE_MAP = process.env.NEXT_PUBLIC_MAP_FAKE === "1" || !process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export function MapView(props: MapViewProps) {
  // Set when the real map cannot start (no WebGL): the offline preview takes over so the rest of the editor keeps working.
  const [unavailable, setUnavailable] = useState(false);
  if (FAKE_MAP) return <FakeMapPanel {...props} />;
  if (unavailable) {
    return (
      <div className="relative h-full w-full">
        <FakeMapPanel {...props} />
        <p role="status" className="pointer-events-none absolute left-1/2 top-[4.5rem] z-10 max-w-[calc(100%-6rem)] -translate-x-1/2 rounded-full bg-surface px-3 py-1 text-center text-xs text-muted shadow ring-1 ring-border lg:bottom-3 lg:top-auto">
          The map could not start on this device, so a simple preview is shown.
        </p>
      </div>
    );
  }
  return <MapPanel {...props} onUnavailable={() => setUnavailable(true)} />;
}
