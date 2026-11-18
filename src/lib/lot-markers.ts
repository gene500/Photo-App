import { haversineMeters } from "@/lib/geo";
import { hasContent } from "@/lib/text";
import type { Stop } from "@/lib/types";

/** Lots closer together than this share one marker. */
export const LOT_MERGE_M = 30;
/** Longest label drawn on the map (characters, including the ellipsis); the full text is in the aria-label. */
export const LOT_LABEL_MAX = 18;
/** The labels show from this zoom up; below it only the P shows, so labels do not pile up. */
export const LOT_LABEL_MIN_ZOOM = 11;

export type LotStop = Pick<Stop, "id" | "name" | "access">;
export type LotGroup = {
  /** Where the P is drawn (the first lot of the group). */
  lat: number;
  lng: number;
  /** Short visible text: the lot name cut to size, "Parking" when it has none, "Parking ×N" for a merged group. */
  label: string;
  ariaLabel: string;
  count: number;
  stopIds: string[];
  stopNames: string[];
  lotNames: string[];
  /** The selected stop's lot: drawn larger. */
  selected: boolean;
};

/** The lot name for the map: "Parking" without one, cut to LOT_LABEL_MAX characters (by code point) with an ellipsis. */
export function lotLabel(name: string | null): string {
  const n = name && hasContent(name) ? name.trim() : "Parking";
  const chars = [...n];
  return chars.length <= LOT_LABEL_MAX ? n : `${chars.slice(0, LOT_LABEL_MAX - 1).join("").trimEnd()}…`;
}

export function lotAriaLabel(stopNames: string[], lotNames: string[]): string {
  return `Parking for ${stopNames.join(", ")}: ${lotNames.join(", ")}`;
}

/** One group per distinct lot spot, in stop order; lots within LOT_MERGE_M of a group's first lot join it. */
export function groupLots(stops: LotStop[], selectedId: string | null | undefined): LotGroup[] {
  const groups: LotGroup[] = [];
  for (const s of stops) {
    if (!s.access) continue;
    const full = s.access.name && hasContent(s.access.name) ? s.access.name.trim() : "Parking";
    const g = groups.find((x) => haversineMeters(x, s.access!) <= LOT_MERGE_M);
    if (g) {
      g.count += 1;
      g.stopIds.push(s.id);
      g.stopNames.push(s.name);
      if (!g.lotNames.includes(full)) g.lotNames.push(full);
      if (s.id === selectedId) g.selected = true;
    } else {
      groups.push({ lat: s.access.lat, lng: s.access.lng, label: "", ariaLabel: "", count: 1, stopIds: [s.id], stopNames: [s.name], lotNames: [full], selected: s.id === selectedId });
    }
  }
  for (const g of groups) {
    g.label = g.count > 1 ? `Parking ×${g.count}` : lotLabel(g.lotNames[0] === "Parking" ? null : g.lotNames[0]);
    g.ariaLabel = lotAriaLabel(g.stopNames, g.lotNames);
  }
  return groups;
}

/** Changes when the markers must be rebuilt (position, text), not when only the selection moves. */
export function lotSignature(groups: LotGroup[]): string {
  return groups.map((g) => `${g.lat},${g.lng},${g.label},${g.ariaLabel}`).join("|");
}
