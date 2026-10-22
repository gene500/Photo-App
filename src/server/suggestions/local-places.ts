import { haversineMeters } from "@/lib/geo";
import type { LngLat } from "@/lib/types";
import { prisma } from "../db";
import { TtlCache } from "./cache";
import { cellRuns, cellsForCircle, cellsForRing, createRingTester, pointInRing } from "./places-grid";

/** Rows of the local `Place` table. */
export type PlaceRow = { id: string; name: string; kind: string; lat: number; lng: number };

/**
 * The local copy holds the United States (the 50 states and DC), Canada, Mexico, South Korea and Japan. Anywhere else, the public Overpass
 * servers are asked instead. Alaska west of its Canadian border, the Aleutians and Hawaii are boxes (the sea around
 * them is Russia, Canada or open water); the rest is one ring.
 */
const US_BOXES = [
  { minLat: 51, maxLat: 71.6, minLng: -168.2, maxLng: -141.2 }, // Alaska mainland, west to Cape Prince of Wales (Chukotka and Wrangel Island lie beyond, in Russia)
  { minLat: 51, maxLat: 57.6, minLng: -179.9, maxLng: -168.2 }, // Aleutians and the Pribilofs
  { minLat: 62.9, maxLat: 63.9, minLng: -172.2, maxLng: -168.2 }, // St Lawrence Island
  { minLat: 18.8, maxLat: 22.4, minLng: -160.7, maxLng: -154.7 }, // Hawaii
];

/**
 * Mainland North America from the Yukon border to the Guatemala and Belize borders: the lower 48, Canada south of 76°N
 * (the high Arctic islands go to Overpass), the Alaska panhandle and Mexico. Coasts run out into the sea, clear of
 * Greenland, the Bahamas, Cuba and Central America. Points are [lng, lat].
 */
const NORTH_AMERICA: LngLat[] = [
  [-141, 76], [-73, 76], [-66, 71], [-60, 66], [-58, 60.5], [-54, 55], [-51.5, 52], [-51.5, 46.5], [-58.5, 44.0], [-66.5, 43.0],
  [-69.0, 40.0], [-73.5, 38.5], [-75.0, 35.0], [-79.0, 31.0], [-79.5, 25.5], [-80.0, 24.4], [-83.0, 24.3], [-87.0, 27.0],
  [-93.0, 28.0], [-96.9, 26.1], [-97.0, 23.0], [-96.0, 20.0], [-92.0, 20.5], [-90.0, 22.0], [-86.3, 21.8], [-86.3, 18.5],
  [-88.3, 18.45], [-88.9, 17.9], [-89.15, 17.81], [-90.98, 17.81], [-90.98, 17.25], [-91.4, 16.1], [-92.2, 15.2], [-92.2, 14.55],
  [-93.0, 14.0], [-95.0, 15.5], [-99.5, 16.3], [-102.5, 17.3], [-106.5, 19.0], [-107.5, 21.0], [-112.0, 22.0], [-118.0, 28.0],
  [-125.0, 34.0], [-125.5, 40.0], [-131.5, 48.0], [-141.0, 54.0],
];

/**
 * South Korea with Jeju, the Marado and Ulleungdo/Dokdo, and the western islands up to Baengnyeongdo. The northern edge
 * follows the DMZ roughly; North Korea (Pyongyang and Kaesong) lies north of it. Points are [lng, lat].
 */
const SOUTH_KOREA: LngLat[] = [
  [124.5, 38.1], [126.7, 37.95], [128.0, 38.35], [128.5, 38.65], [131.0, 38.1], [132.2, 37.2], [130.6, 35.0], [129.8, 34.5],
  [128.0, 33.8], [127.4, 32.9], [126.0, 32.9], [125.0, 33.9], [124.6, 35.5], [124.5, 37.0],
];

/**
 * Japan from Hokkaido (Cape Soya, 45.5°N) to the Yaeyama islands (Yonaguni) and Ogasawara, including Tsushima. The north edge
 * stays south of Sakhalin (45.9°N) and the Kurils; the west edge keeps clear of Taiwan, China and Korea. Points are [lng, lat].
 */
const JAPAN: LngLat[] = [
  [142.4, 45.65], [146.0, 44.6], [146.0, 23.8], [122.8, 23.8], [122.8, 26.0], [127.5, 29.5], [128.2, 32.0], [128.8, 34.0],
  [129.0, 34.9], [129.7, 35.5], [133.0, 37.8], [137.5, 39.0], [139.0, 43.0], [140.8, 45.65],
];

export function inLocalCoverage(lat: number, lng: number): boolean {
  return (
    US_BOXES.some((b) => lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng) ||
    pointInRing(lng, lat, NORTH_AMERICA) ||
    pointInRing(lng, lat, SOUTH_KOREA) ||
    pointInRing(lng, lat, JAPAN)
  );
}

/** Rows of consecutive cells are read with one `cell BETWEEN a AND b` term each; a statement carries at most this many terms. */
export const RUNS_PER_QUERY = 100;
/** A corridor covering more cells than this is refused by the local copy. */
export const MAX_RING_CELLS = 20_000;
export const CELL_CACHE_TTL_MS = 30 * 60_000;
export const CELL_CACHE_MAX = 3000;

export type CellReader = (cells: number[]) => Promise<PlaceRow[]>;

/** Reads the rows of the given runs of cells; one round trip per call. */
type RunReader = (runs: [number, number][]) => Promise<(PlaceRow & { cell: number })[]>;

/**
 * Plain SQL rather than `findMany({ where: { OR: [...] } })`: the same query plan (one index range search per run), but
 * without Prisma building and compiling a big OR tree, which is about twice as fast. Every value is a bound parameter.
 */
const readRuns: RunReader = async (runs) => {
  const where = runs.map(() => "cell BETWEEN ? AND ?").join(" OR ");
  const rows = await prisma.$queryRawUnsafe<(PlaceRow & { cell: number | bigint })[]>(`SELECT id, name, kind, lat, lng, cell FROM Place WHERE ${where}`, ...runs.flat());
  // Fixed up in place: copying every row (thousands per search) just to convert one column is measurable.
  for (const r of rows) if (typeof r.cell !== "number") r.cell = Number(r.cell);
  return rows as (PlaceRow & { cell: number })[];
};

/**
 * A cell reader that turns the wanted cells into runs, asks the database for them in parallel statements of at most
 * `RUNS_PER_QUERY` runs (so a search is a single round trip however long the route), and remembers every cell it has read
 * (empty ones too) for a while, so a nearby second search needs no round trip at all. Nothing is remembered if a read fails.
 */
export function createCellReader(readRunRows: RunReader, now: () => number = Date.now): CellReader & { clear: () => void } {
  const cache = new TtlCache<PlaceRow[]>(CELL_CACHE_TTL_MS, CELL_CACHE_MAX, now);
  const reader = async (cells: number[]): Promise<PlaceRow[]> => {
    const wanted = [...new Set(cells)];
    const have = new Map<number, PlaceRow[]>();
    const missing: number[] = [];
    for (const cell of wanted) {
      const hit = cache.get(String(cell));
      if (hit) have.set(cell, hit);
      else missing.push(cell);
    }
    if (missing.length > 0) {
      const runs = cellRuns(missing);
      const groups: [number, number][][] = [];
      for (let i = 0; i < runs.length; i += RUNS_PER_QUERY) groups.push(runs.slice(i, i + RUNS_PER_QUERY));
      const fetched = (await Promise.all(groups.map(readRunRows))).flat();
      const byCell = new Map<number, PlaceRow[]>(missing.map((c) => [c, []]));
      // An explicit literal rather than `{ cell, ...row }`: object rest is several times slower per row.
      for (const r of fetched) byCell.get(r.cell)?.push({ id: r.id, name: r.name, kind: r.kind, lat: r.lat, lng: r.lng });
      for (const [cell, rows] of byCell) {
        cache.set(String(cell), rows);
        have.set(cell, rows);
      }
    }
    return wanted.flatMap((cell) => have.get(cell) ?? []);
  };
  reader.clear = () => cache.clear();
  return reader;
}

const defaultReader = createCellReader(readRuns);
const readCells: CellReader = defaultReader;

/** Forgets the remembered cells (tests, and after a data re-import in a long-lived process). */
export const clearCellCache = (): void => defaultReader.clear();

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
export async function localPlacesInRing(ring: LngLat[], read: CellReader = readCells, holes: LngLat[][] = []): Promise<unknown[] | null> {
  if (ring.length < 3 || !ring.every(([lng, lat]) => inLocalCoverage(lat, lng))) return null;
  return ringRows(ring, read, holes);
}

/**
 * For a corridor the covered-area check refused (a route running out to sea or on into Central America): whatever places the
 * local copy holds there. Never complete, so the caller shows it only as a fallback while Overpass is asked; a corridor
 * wholly abroad simply finds nothing.
 */
export async function localPlacesInRingPartial(ring: LngLat[], read: CellReader = readCells, holes: LngLat[][] = []): Promise<unknown[] | null> {
  if (ring.length < 3) return null;
  // Cheap geographic filter: a corridor nowhere near North America, Korea or Japan has no local places to find (and must not flush the cell cache).
  const nearCoverage = ([lng, lat]: LngLat) => (lat >= 14 && lat <= 77 && lng >= -180 && lng <= -50) || (lat >= 23 && lat <= 46 && lng >= 122 && lng <= 147);
  if (!ring.some(nearCoverage)) return null;
  return ringRows(ring, read, holes);
}

async function ringRows(ring: LngLat[], read: CellReader, holes: LngLat[][]): Promise<unknown[] | null> {
  const cells = cellsForRing(ring, holes);
  if (cells.length > MAX_RING_CELLS) return null; // not a real corridor: do not read the map for it
  const rows = await read(cells);
  const inside = createRingTester(ring, holes);
  return toElements(rows.filter((r) => inside(r.lng, r.lat)));
}
