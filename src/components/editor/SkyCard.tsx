"use client";

import { useMemo } from "react";
import { useSettings } from "@/components/settings/SettingsProvider";
import { formatClock } from "@/lib/best-time";
import { compassWord, getSkyInfo, type SkyEvent } from "@/lib/sky";

type Props = { lat: number; lng: number; plannedDate: string };

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const CENTER = 50;
const RADIUS = 38;

// Bearings are compass degrees clockwise from north, so 0 is straight up on the dial.
function onDial(bearing: number) {
  const rad = (bearing * Math.PI) / 180;
  return { x: CENTER + RADIUS * Math.sin(rad), y: CENTER - RADIUS * Math.cos(rad) };
}

const bearingText = (b: number) => `${compassWord(b)} ${Math.round(b)}°`;

export function SkyCard({ lat, lng, plannedDate }: Props) {
  const { settings } = useSettings();
  const valid = Number.isFinite(lat) && Number.isFinite(lng) && DATE_SHAPE.test(plannedDate);
  const sky = useMemo(() => {
    if (!valid) return null;
    try {
      return getSkyInfo(lat, lng, plannedDate);
    } catch {
      return null;
    }
  }, [valid, lat, lng, plannedDate]);
  if (!sky) return null;

  const { sunrise, sunset, moon } = sky;
  const clock = (at: Date) => formatClock(at, undefined, settings.timeFormat);
  const row = (label: string, ev: SkyEvent | null, missing: string) => (ev ? `${label} ${clock(ev.at)} · ${bearingText(ev.bearing)}` : missing);
  const dialLabel = sunrise && sunset ? `Sunrise from ${bearingText(sunrise.bearing)}, sunset toward ${bearingText(sunset.bearing)}` : "Sun does not rise and set on this date";

  return (
    <div data-testid="sky-card" className="flex items-start gap-3 rounded-xl bg-background p-3 ring-1 ring-border">
      <svg role="img" aria-label={dialLabel} viewBox="0 0 100 100" className="h-20 w-20 shrink-0 text-muted">
        <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="currentColor" strokeWidth="1" />
        <text x={CENTER} y="9" textAnchor="middle" fontSize="9" fill="currentColor">N</text>
        {sunrise && <circle data-marker="sunrise" cx={onDial(sunrise.bearing).x} cy={onDial(sunrise.bearing).y} r="5" className="fill-accent-strong" />}
        {sunset && <circle data-marker="sunset" cx={onDial(sunset.bearing).x} cy={onDial(sunset.bearing).y} r="5" className="fill-foreground" />}
      </svg>
      <div className="min-w-0 space-y-1 text-sm">
        <p>{row("Sunrise", sunrise, "Sun does not rise on this date")}</p>
        <p>{row("Sunset", sunset, "Sun does not set on this date")}</p>
        <p className="text-xs text-muted">
          {`${moon.phase.charAt(0).toUpperCase()}${moon.phase.slice(1)} · ${moon.illuminationPct}% lit · ${moon.rise ? `Moonrise ${clock(moon.rise)}` : "No moonrise this day"}`}
        </p>
      </div>
    </div>
  );
}
