import { haversineMeters } from "@/lib/geo";
import type { LngLat } from "@/lib/types";
import { prisma } from "../db";
import { cellsForCircle, cellsForRing, pointInRing } from "./places-grid";

/** Rows of the local `Place` table. */
export type PlaceRow = { id: string; name: string; kind: string; lat: number; lng: number };

/**
 * The local copy only holds the United States (the 50 states and DC). Anywhere else, or too near a border to be sure
 * nothing lies across it, the public Overpass servers are asked instead.
 */
const US_BOXES = [
  { minLat: 24.4, maxLat: 49.5, minLng: -125.1, maxLng: -66.9 }, // lower 48
  { minLat: 51, maxLat: 71.6, minLng: -179.9, maxLng: -129.9 }, // Alaska
  { minLat: 18.8, maxLat: 22.4, minLng: -160.7, maxLng: -154.7 }, // Hawaii
];

export function inLocalCoverage(lat: number, lng: number): boolean {
  return US_BOXES.some((b) => lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng);
}

/** SQLite caps bound parameters per statement, so cells are read in chunks. */
const CELLS_PER_QUERY = 400;

export type CellReader = (cells: number[]) => Promise<PlaceRow[]>;

const readCells: CellReader = async (cells) => {
  const rows: PlaceRow[] = [];
  for (let i = 0; i < cells.length; i += CELLS_PER_QUERY) {
    rows.push(...(await prisma.place.findMany({ where: { cell: { in: cells.slice(i, i + CELLS_PER_QUERY) } }, select: { id: true, name: true, kind: true, lat: true, lng: true } })));
  }
  return rows;
};

const KIND_TAGS: Record<string, Record<string, string>> = {
  viewpoint: { tourism: "viewpoint" },
  peak: { natural: "peak" },
  attraction: { tourism: "attraction" },
};

/** Rows shaped like Overpass elements, so the one parser (ranking, de-duplication, cap) serves both sources. */
export function toElements(rows: PlaceRow[]): unknown[] {
  return rows.flatMap((r) => {
    const [type, id] = r.id.split("/");
    const tags = KIND_TAGS[r.kind];
    if (!tags || !type || !Number.isFinite(Number(id))) return [];
    return [{ type, id: Number(id), lat: r.lat, lon: r.lng, tags: r.name ? { ...tags, name: r.name } : { ...tags } }];
  });
}

/** Places within `radiusKm` of a point; null when the point is outside the area the local copy covers. */
export async function localPlacesAround(lat: number, lng: number, radiusKm: number, read: CellReader = readCells): Promise<unknown[] | null> {
  const edge = (dLat: number, dLng: number) => inLocalCoverage(lat + dLat * (radiusKm / 111), lng + dLng * (radiusKm / 111));
  if (!inLocalCoverage(lat, lng) || ![[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => edge(a, b))) return null;
  const rows = await read(cellsForCircle(lat, lng, radiusKm));
  return toElements(rows.filter((r) => haversineMeters({ lat, lng }, r) <= radiusKm * 1000));
}

/** Places inside a corridor polygon; null when any part of it lies outside the covered area. */
export async function localPlacesInRing(ring: LngLat[], read: CellReader = readCells): Promise<unknown[] | null> {
  if (ring.length < 3 || !ring.every(([lng, lat]) => inLocalCoverage(lat, lng))) return null;
  const rows = await read(cellsForRing(ring));
  return toElements(rows.filter((r) => pointInRing(r.lng, r.lat, ring)));
}
