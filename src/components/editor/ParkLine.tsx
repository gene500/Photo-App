"use client";

import { useSettings } from "@/components/settings/SettingsProvider";
import { parkText } from "@/lib/itinerary";
import type { Stop } from "@/lib/types";

/** "Park at North lot, walk 1.2 mi to <stop>" for a stop with a saved lot; nothing without one. */
export function ParkLine({ stop, className = "text-xs text-foreground/80" }: { stop: Pick<Stop, "name" | "access">; className?: string }) {
  const { settings } = useSettings();
  const text = parkText({ name: stop.name, access: stop.access, walkMeters: stop.access?.walkMeters ?? null }, settings.distanceUnit);
  if (!text) return null;
  return <p data-testid="park-line" className={`break-words ${className}`}>{text}</p>;
}
