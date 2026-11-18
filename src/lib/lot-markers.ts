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

/**
 * One group per distinct lot spot, in stop order. Single linkage: a lot within LOT_MERGE_M of ANY member joins the group,
 * so a chain of lots (each close to the next) is one marker whatever the stop order. The P sits at the group's first lot.
 */
export function groupLots(stops: LotStop[], selectedId: string | null | undefined): LotGroup[] {
  const withLot = stops.filter((s) => s.access);
  const parent = withLot.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < withLot.length; i++) {
    for (let j = i + 1; j < withLot.length; j++) {
      if (haversineMeters(withLot[i].access!, withLot[j].access!) <= LOT_MERGE_M) {
        const a = find(i), b = find(j);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); // the root is the lowest stop index
      }
    }
  }
  const groups: LotGroup[] = [];
  const byRoot = new Map<number, LotGroup>();
  withLot.forEach((s, i) => {
    const full = s.access!.name && hasContent(s.access!.name) ? s.access!.name.trim() : "Parking";
    const root = find(i);
    const g = byRoot.get(root);
    if (g) {
      g.count += 1;
      g.stopIds.push(s.id);
      g.stopNames.push(s.name);
      if (!g.lotNames.includes(full)) g.lotNames.push(full);
      if (s.id === selectedId) g.selected = true;
    } else {
      const ng: LotGroup = { lat: s.access!.lat, lng: s.access!.lng, label: "", ariaLabel: "", count: 1, stopIds: [s.id], stopNames: [s.name], lotNames: [full], selected: s.id === selectedId };
      byRoot.set(root, ng);
      groups.push(ng);
    }
  });
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

/** Where a lot's label box sits relative to the marker's point, in px (the P is drawn lower-right of the point). */
export const LOT_LABEL_DX = 30;
export const LOT_LABEL_DY = 16;
const LABEL_H = 18;
const LABEL_MAX_W = 152; // 9.5rem, as in the CSS

/** A rough label width in px (11 px semibold text plus padding), capped like the CSS max-width. */
export function estimateLabelWidth(label: string): number {
  return Math.min(LABEL_MAX_W, [...label].length * 6.5 + 10);
}

/**
 * Which lot labels to hide so they do not overlap. Input: each group's marker point in screen px and its label width,
 * in group order. The selected group is placed first, then the rest in order; a label whose box overlaps an already
 * visible one is hidden (the P stays). Returns hidden flags in input order.
 */
export function hiddenLotLabels(items: { x: number; y: number; width: number; selected?: boolean }[]): boolean[] {
  const hidden = items.map(() => false);
  const shown: { l: number; r: number; t: number; b: number }[] = [];
  const order = items.map((_, i) => i).sort((a, b) => Number(!!items[b].selected) - Number(!!items[a].selected) || a - b);
  for (const i of order) {
    const it = items[i];
    const box = { l: it.x + LOT_LABEL_DX, r: it.x + LOT_LABEL_DX + it.width, t: it.y + LOT_LABEL_DY - LABEL_H / 2, b: it.y + LOT_LABEL_DY + LABEL_H / 2 };
    if (shown.some((o) => box.l < o.r && o.l < box.r && box.t < o.b && o.t < box.b)) hidden[i] = true;
    else shown.push(box);
  }
  return hidden;
}
