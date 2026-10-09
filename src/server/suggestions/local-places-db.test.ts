import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../db";
import { clearCellCache, localPlacesAround, localPlacesInRing } from "./local-places";
import { buildCorridor } from "./corridor";
import { cellOf } from "./places-grid";
import { clearSuggestionCache, findSuggestionsAround } from "./service";

const at = (id: string, lat: number, lng: number, kind = "viewpoint") => ({ id, name: id, kind, lat, lng, cell: cellOf(lat, lng) });
const ROWS = [at("node/9001", 37.3, -113.03), at("node/9002", 37.31, -113.0), at("node/9003", 37.9, -113.03), at("node/9004", 37.29, -113.02, "peak")];

describe("the default cell reader against the database", () => {
  beforeEach(async () => {
    clearCellCache();
    await prisma.place.createMany({ data: ROWS });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.place.deleteMany({ where: { id: { in: ROWS.map((r) => r.id) } } });
    clearCellCache();
  });

  it("finds the places inside a circle with one query, and a nearby repeat without any", async () => {
    const spy = vi.spyOn(prisma, "$queryRawUnsafe");
    const found = (await localPlacesAround(37.2982, -113.0263, 24)) as { id: number }[];
    expect(found.map((e) => e.id).sort()).toEqual([9001, 9002, 9004]); // 9003 is ~67 km away
    expect(spy).toHaveBeenCalledTimes(1);
    await localPlacesAround(37.3, -113.03, 20);
    expect(spy).toHaveBeenCalledTimes(1); // every cell of the smaller circle was already read
  });

  it("finds the places in a corridor", async () => {
    const ring = buildCorridor([[-113.1, 37.2], [-112.9, 37.4]]);
    const found = (await localPlacesInRing(ring)) as { id: number }[];
    expect(found.map((e) => e.id)).toContain(9002);
  });

  it("answers a whole search through the real stack: the 40 nearest viewpoints win the cap, nearest first", async () => {
    // 50 viewpoints in a line east of the centre, ~0.4 km apart; ids descend with distance so id order would pick the far ones
    const line = Array.from({ length: 50 }, (_, i) => at(`node/${8000 - i}`, 37.2982, -113.0263 + 0.005 * (i + 1)));
    await prisma.place.deleteMany({ where: { id: { in: ROWS.map((r) => r.id) } } });
    await prisma.place.createMany({ data: line });
    try {
      clearSuggestionCache();
      const result = await findSuggestionsAround([-113.0263, 37.2982], { enrich: false, fetchOverpass: async () => { throw new Error("must not be asked"); } });
      expect(result).toHaveLength(40);
      expect(result.map((s) => s.osmId)).toEqual(line.slice(0, 40).map((r) => r.id));
    } finally {
      await prisma.place.deleteMany({ where: { id: { in: line.map((r) => r.id) } } });
    }
  });
});
