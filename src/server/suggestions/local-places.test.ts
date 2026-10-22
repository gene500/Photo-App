import { describe, expect, it, vi } from "vitest";
import type { LngLat } from "@/lib/types";
import { buildCorridor } from "./corridor";
import { createCellReader, inLocalCoverage, localPlacesAround, localPlacesInRing, localPlacesInRingPartial, RUNS_PER_QUERY, toElements, type PlaceRow } from "./local-places";
import { cellOf } from "./places-grid";

const row = (id: string, lat: number, lng: number, kind = "viewpoint", name = "Spot"): PlaceRow => ({ id, name, kind, lat, lng });

describe("inLocalCoverage", () => {
  it("covers the US, Canada, Mexico, South Korea and Japan, and nothing else", () => {
    expect(inLocalCoverage(37.3, -113)).toBe(true); // Zion
    expect(inLocalCoverage(64.8, -147.7)).toBe(true); // Fairbanks
    expect(inLocalCoverage(21.3, -157.8)).toBe(true); // Honolulu
    expect(inLocalCoverage(51.0, -114.1)).toBe(true); // Calgary
    expect(inLocalCoverage(19.43, -99.13)).toBe(true); // Mexico City
    expect(inLocalCoverage(51.5, -0.1)).toBe(false); // London
  });
  it("covers South Korea and Japan, and not their neighbours", () => {
    for (const [lat, lng] of [[37.57, 126.98], [35.18, 129.07], [33.5, 126.53], [37.5, 130.87], [35.68, 139.7], [34.69, 135.5], [43.06, 141.35], [26.21, 127.68], [33.59, 130.4], [27.09, 142.19], [24.45, 123.0], [34.2, 129.3]]) {
      expect(inLocalCoverage(lat, lng), `${lat},${lng}`).toBe(true);
    }
    for (const [lat, lng] of [[39.02, 125.75], [43.12, 131.9], [31.23, 121.47], [25.03, 121.56], [46.96, 142.73]]) {
      expect(inLocalCoverage(lat, lng), `${lat},${lng}`).toBe(false);
    }
  });
  it("covers the interior and coasts of the lower 48", () => {
    for (const [lat, lng] of [[47.6, -122.3], [37.8, -122.4], [34.05, -118.2], [32.72, -117.16], [41.9, -87.6], [40.7, -74], [42.36, -71.06], [25.8, -80.2], [24.55, -81.8], [29.76, -95.4], [44.98, -93.27], [39.7, -105], [33.4, -112], [35.1, -106.6]]) {
      expect(inLocalCoverage(lat, lng), `${lat},${lng}`).toBe(true);
    }
  });
  it("covers both sides of the Canadian and Mexican borders and the Canadian coasts", () => {
    for (const [lat, lng] of [[43.65, -79.38], [45.5, -73.57], [45.42, -75.7], [42.3, -83.0], [49.28, -123.12], [48.43, -123.37], [41.77, -82.68], [32.5, -117.03], [31.7, -106.45], [25.7, -100.3], [60.7, -135.0], [49.9, -97.1], [44.65, -63.57], [47.56, -52.71], [62.45, -114.37], [22.9, -109.9], [20.65, -87.0], [21.16, -86.85], [16.85, -99.9]]) {
      expect(inLocalCoverage(lat, lng), `${lat},${lng}`).toBe(true);
    }
  });
  it("leaves Greenland, the Bahamas, Cuba, Central America and the high Arctic to Overpass", () => {
    for (const [lat, lng] of [[64.18, -51.7], [76.5, -68.7], [25.04, -77.35], [23.13, -82.38], [14.63, -90.51], [17.5, -88.2], [15.5, -88.0], [79.9, -85.0]]) {
      expect(inLocalCoverage(lat, lng), `${lat},${lng}`).toBe(false);
    }
  });
  it("excludes Chukotka and Wrangel Island but keeps western Alaska, St Lawrence Island and the Aleutians", () => {
    for (const [lat, lng] of [[71.2, -179.4], [64.38, -173.3], [66.3, -179.1], [66.07, -169.7]]) {
      expect(inLocalCoverage(lat, lng), `${lat},${lng}`).toBe(false);
    }
    for (const [lat, lng] of [[64.5, -165.4], [65.6, -168.1], [63.78, -171.7], [51.88, -176.6], [57.12, -170.28], [71.29, -156.8], [66.9, -162.6]]) {
      expect(inLocalCoverage(lat, lng), `${lat},${lng}`).toBe(true);
    }
  });
});

describe("toElements", () => {
  it("shapes rows like Overpass elements and drops malformed ones", () => {
    expect(toElements([row("node/1", 1, 2), row("way/9", 3, 4, "peak", ""), row("bad", 1, 1), row("node/2", 1, 1, "mystery")])).toEqual([
      { type: "node", id: 1, lat: 1, lon: 2, tags: { tourism: "viewpoint", name: "Spot" } },
      { type: "way", id: 9, lat: 3, lon: 4, tags: { natural: "peak" } },
    ]);
  });
});

describe("localPlacesAround", () => {
  it("reads the grid cells around the point and keeps only places inside the circle", async () => {
    const read = vi.fn(async () => [row("node/1", 37.3, -113.03), row("node/2", 37.9, -113.03)]); // second is ~67 km away
    const found = await localPlacesAround(37.2982, -113.0263, 24, read);
    expect(found).toHaveLength(1);
    const cells = (read.mock.calls[0] as unknown as [number[]])[0];
    expect(cells).toContain(cellOf(37.2982, -113.0263));
  });

  it("returns null outside North America, and when the circle reaches out to sea beyond the covered coast", async () => {
    const read = vi.fn(async () => []);
    expect(await localPlacesAround(51.5, -0.1, 24, read)).toBeNull();
    expect(await localPlacesAround(14.9, -91.6, 24, read)).toBeNull(); // Guatemala
    expect(read).not.toHaveBeenCalled();
  });
});

describe("localPlacesInRing", () => {
  const route: LngLat[] = [[-119.79, 36.74], [-119.0, 37.5]];
  const ring = buildCorridor(route);

  it("keeps places inside the corridor and null when it leaves the covered area", async () => {
    const read = vi.fn(async () => [row("node/1", 37.12, -119.395), row("node/2", 37.4, -119.8)]);
    expect(await localPlacesInRing(ring, read)).toHaveLength(1);
    expect(await localPlacesInRing(buildCorridor([[-0.1, 51.5], [0.2, 51.6]]), read)).toBeNull();
  });
});

describe("createCellReader", () => {
  type RunRow = PlaceRow & { cell: number };
  const placed = (id: string, cell: number): RunRow => ({ id, name: "n", kind: "viewpoint", lat: 0, lng: 0, cell });
  const inRuns = (runs: [number, number][], all: RunRow[]) => all.filter((r) => runs.some(([a, b]) => r.cell >= a && r.cell <= b));
  const table = [placed("node/1", 10), placed("node/2", 11), placed("node/3", 50)];

  it("asks for consecutive cells as runs, in one statement, and returns the rows without the cell column", async () => {
    const run = vi.fn(async (runs: [number, number][]) => inRuns(runs, table));
    const read = createCellReader(run);
    const rows = await read([11, 10, 50, 60]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toEqual([[10, 11], [50, 50], [60, 60]]);
    expect(rows.map((r) => r.id).sort()).toEqual(["node/1", "node/2", "node/3"]);
    expect(rows[0]).not.toHaveProperty("cell");
  });

  it("splits a long list of runs into parallel statements (one round trip deep), each within the limit", async () => {
    let active = 0;
    let maxActive = 0;
    const sizes: number[] = [];
    const run = vi.fn(async (runs: [number, number][]) => {
      sizes.push(runs.length);
      maxActive = Math.max(maxActive, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return [];
    });
    const read = createCellReader(run);
    await read(Array.from({ length: RUNS_PER_QUERY * 2 + 30 }, (_, i) => i * 2)); // all isolated cells: one run each
    expect(sizes.sort((a, b) => a - b)).toEqual([30, RUNS_PER_QUERY, RUNS_PER_QUERY]);
    expect(maxActive).toBe(3);
  });

  it("remembers cells, empty ones too: a repeat or an overlapping read only fetches what is new", async () => {
    const run = vi.fn(async (runs: [number, number][]) => inRuns(runs, table));
    const read = createCellReader(run);
    await read([10, 11, 12]);
    expect(await read([10, 11, 12])).toHaveLength(2);
    expect(run).toHaveBeenCalledTimes(1);
    await read([11, 12, 13]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toEqual([[13, 13]]);
  });

  it("forgets after the time-to-live, on clear(), and never remembers a failed read", async () => {
    let t = 0;
    const run = vi.fn(async (runs: [number, number][]) => inRuns(runs, table));
    const read = createCellReader(run, () => t);
    await read([10]);
    t += 31 * 60_000;
    await read([10]);
    expect(run).toHaveBeenCalledTimes(2);
    read.clear();
    await read([10]);
    expect(run).toHaveBeenCalledTimes(3);

    const failing = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue([placed("node/1", 10)]);
    const read2 = createCellReader(failing);
    await expect(read2([10])).rejects.toThrow("db down");
    expect(await read2([10])).toHaveLength(1);
  });
});

describe("localPlacesInRingPartial", () => {
  const inside = (lng: number, lat: number) => [[lng, lat], [lng + 0.05, lat], [lng + 0.05, lat + 0.05], [lng, lat + 0.05]] as [number, number][];
  it("answers for a corridor that only touches the covered area, where the full lookup refuses", async () => {
    // Half in Chiapas (covered), half across the line in Guatemala (not covered).
    const ring: [number, number][] = [[-92.6, 14.8], [-91.8, 14.8], [-91.8, 15.4], [-92.6, 15.4]];
    const read = async () => [];
    expect(await localPlacesInRing(ring, read)).toBeNull();
    expect(await localPlacesInRingPartial(ring, read)).toEqual([]);
  });
  it("reads whatever the local copy holds for a corridor outside the covered box, and is null for a degenerate ring", async () => {
    const ring = inside(-82.4, 23.1); // Cuba: nothing is stored there, but the read is allowed
    const got = await localPlacesInRingPartial(ring, async () => [row("node/1", 23.12, -82.38)]);
    expect(got).toHaveLength(1);
    expect(await localPlacesInRingPartial([[0, 0], [1, 1]], async () => [])).toBeNull();
    // A corridor in Europe is not read at all.
    const read = vi.fn(async () => []);
    expect(await localPlacesInRingPartial(inside(2.3, 48.8), read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
  it("reads for a corridor in Japan or Korea, and not for one in South America", async () => {
    const got = await localPlacesInRingPartial(inside(139.7, 35.6), async () => [row("node/1", 35.62, 139.72)]);
    expect(got).toHaveLength(1);
    expect(await localPlacesInRingPartial(inside(127.0, 37.5), async () => [])).toEqual([]);
    const read = vi.fn(async () => []);
    expect(await localPlacesInRingPartial(inside(-58.4, -34.6), read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});
