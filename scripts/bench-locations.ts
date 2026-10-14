import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "vitest";
import type { LngLat } from "@/lib/types";
import { buildCorridor } from "@/server/suggestions/corridor";
import { clearCellCache, localPlacesInRing } from "@/server/suggestions/local-places";
import { cellsForRing } from "@/server/suggestions/places-grid";
import { clearSuggestionCache, findSuggestions } from "@/server/suggestions/service";

type Loc = { name: string; route: LngLat[]; batch: string };

it("locations", async () => {
  const dir = process.env.LOCS_DIR!;
  const locs: Loc[] = [];
  for (const f of readdirSync(dir).filter((f) => /^batch\d+\.json$/.test(f)).sort()) {
    for (const l of JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Loc[]) locs.push({ ...l, batch: f.replace(".json", "") });
  }
  const rows: Record<string, unknown>[] = [];
  for (const l of locs) {
    let overpassCalls = 0;
    clearSuggestionCache();
    clearCellCache();
    const t = performance.now();
    let n = -1, error: string | null = null;
    try {
      const out = await findSuggestions(l.route, {
        enrich: false,
        fetchOverpass: async () => { overpassCalls++; await new Promise((r) => setTimeout(r, Number(process.env.OP_DELAY ?? 3000))); return { elements: [] }; }, // a typical 3 s Overpass, never the network
      });
      n = out.length;
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    const ms = performance.now() - t;
    let local = "err";
    try { const r = await localPlacesInRing(buildCorridor(l.route)); local = r === null ? "null" : String(r.length); } catch { /* ignore */ }
    let cells = -1, km = 0;
    try { cells = cellsForRing(buildCorridor(l.route)).length; } catch { /* ignore */ }
    for (let i = 1; i < l.route.length; i++) km += Math.hypot((l.route[i][0] - l.route[i - 1][0]) * 85, (l.route[i][1] - l.route[i - 1][1]) * 111);
    rows.push({ batch: l.batch, name: l.name, points: l.route.length, km: Math.round(km), cells, ms: Math.round(ms * 10) / 10, count: n, overpassCalls, local, error });
  }
  writeFileSync(process.env.RESULT!, JSON.stringify(rows, null, 1));
  const ts = rows.map((r) => r.ms as number).sort((a, b) => a - b);
  console.error(`LOCS=${rows.length} median=${ts[Math.floor(ts.length / 2)]}ms p95=${ts[Math.floor(ts.length * 0.95)]}ms max=${ts[ts.length - 1]}ms`);
});
