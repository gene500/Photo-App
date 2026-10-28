# A53 design note: hike to the point of interest

## Goal (owner decisions)

In My trip, under a stop's temperature line: `Hike 1.2 mi one way` (distance only, honours the Imperial/Metric setting; no time, difficulty or elevation). The hike's route is drawn on the map as a dotted, matte green line for the selected stop, and for every stop with a hike while the per-device "Show hikes" setting (Settings > Map, on by default) is on. The line is its own map layer: never part of the trip route, GPX, PDF, saved geometry, or the A49 flow / A51 route layers.

## Data (checked against the live services, 27 Oct 2026)

**NPS Public Trails** (`.../NPS_Public_Trails/FeatureServer/0/query`, `f=geojson`, no key). Answer is a GeoJSON FeatureCollection of `LineString`s; properties used: `TRLNAME`, `TRLTYPE` ("Standard Terra Trail"), `TRLUSE` ("Hiker/Pedestrian"), `TRLSTATUS`, `UNITNAME`. `Shape__Length` is in degrees (useless), so the length is measured from the geometry. Fixture: `src/server/hike/fixtures/nps-delicate-arch.json` (8 lines). Finding: coverage is incomplete (the Delicate Arch Trail has only its first ~200 m mapped), so an NPS answer is only trusted when a mapped trail passes within 300 m of the place; otherwise we fall through to OSM.

**OSM via Overpass** (reuses `fetchOverpass`: mirrors, hedging, retry). One query for a box around the stop: `way[highway=path|footway|track|steps|bridleway]` (minus sidewalks/crossings), the member ways of `route=hiking` relations (relation members only, not whole relations, which can be country-long), `node[highway=trailhead]`, `node[amenity=parking]`; `out tags geom qt`. Elements are `{type:"way", tags, geometry:[{lat,lon}]}` and `{type:"node", lat, lon, tags}`. Fixture: `osm-delicate-arch.json` (15 usable ways, 2 trailheads). Dropped: private/`foot=no` ways, and `track`s named like roads (Cache Valley Road).

Attribution: "Trail data (c) OpenStreetMap contributors" or "Trail data: National Park Service" in the map source `attribution` text (shown in Mapbox's attribution control while hikes are drawn). There is no per-row caption (removed in A57).

## Algorithm (`src/server/hike/graph.ts`)

Work in a flat metre grid around the stop. Vertices within 6 m are one node; a trail end within 8 m of the side of another trail splits it (T-junction). The stop is snapped onto the nearest trail (within 300 m, else no hike). Dijkstra from the stop. Start = the nearest reachable **trailhead** (first tier with a reachable one: OSM trailhead nodes, then parking); if none, the nearest **dead end** at least 120 m away. A trailhead closer than 120 m means "you are at the trailhead": no hike. Max 30 km, max 40,000 input vertices. Result: line from start to stop, simplified (Douglas-Peucker, 2 m, coarser until at most 200 points), 5-decimal coordinates, distance rounded to 10 m.

## Server

`GET /api/hike?lat&lng` (`src/app/api/hike/route.ts`): `requireUserId`, `enforceLimit("hike")` (60/min per user, in-memory like `weather`), `hikeQuerySchema` (same point rules as weather), answers `{hike: Hike | null}` with `Cache-Control: private, max-age=3600` (hike) or 600 (none). Never 5xx from upstream trouble: failures are `{hike:null}`.
`src/server/hike/service.ts`: NPS (6 s timeout) then OSM (12 s per mirror, 15 s overall deadline, 6 MB maxsize) as fallback; keyed on a 4-decimal grid (about 11 m); in-memory LRU of 500; TTL 24 h for a hike, 1 h for none, 5 min for a failed lookup; in-flight de-duplication. `EXTERNAL_APIS_FAKE=1`: `fakeHike` (canned 1.2 mi hike within 0.05 deg of (37, -119.5), null elsewhere); no network.

## Client

`src/lib/hike-cache.ts` (one request per cell, at most 3 in flight, subscriber counting with abort on last release, 30 min / 10 min / 1 min TTLs, no request offline) and `src/lib/use-hike.ts` (`useHike`, `useHikes`). `TripPlanList` row: `HikeLines` renders only when a hike exists (no reserved space), no per-row button. `TripEditor` passes `hikes` (every stop when `settings.showHikes`, else only the selected stop) to `MapView`; `MapPanel` calls `ensureHikeLayer` (`hike-layer.ts`) on load, whenever the list changes, and on `style.load` (re-adds after a style reload). `FakeMapPanel` draws `<polyline data-testid="hike-line" data-stop-id data-points>`.

Line style: `#3f6b3a` (muted dark green, about 4.9:1 on the beige `#d8d1bd`), `line-dasharray [0.01, 2]` with round caps = round dots, width 3 to 5 px by zoom, opacity 0.95, no blur/casing/glow. Hex because Mapbox paint cannot read CSS variables.

## Safe defaults chosen (owner can change)

- In-memory cache only, no database table (a Turso migration for a 24 h shared cache was judged not worth it for a decorative line). Cold serverless instances re-query.
- The hike line shows for the selected stop on any tab, not only My trip.
- Search area is a 2.5 km box around the stop; a trailhead farther than that is not found.
- Failed lookups are remembered 5 min server-side so a busy Overpass is not hammered.
- Offline: no hike (nothing stored in the offline copy).
- Rate limit 60/min/user, per instance (same tradeoff as weather).

## Known limitations

- NPS has no trailhead layer here, so inside parks the start is the nearest dead end of the mapped trails, which can be a spur short of the real trailhead (Vernal Fall and Horseshoe Bend came out shorter than the signed hikes). OSM answers use real trailhead nodes when present.
- Trail data gaps: a gap in the mapping gives "no hike" or a shorter walk. Loops are not special-cased (shortest way).
- Public Overpass is shared and slow; dense cities (Griffith Park scale) can exceed the size/time limits and then show no hike.
- Straight-line stitching tolerance: 6 m joins, 8 m T-joins; bridges/crossings without shared nodes are not joined.
