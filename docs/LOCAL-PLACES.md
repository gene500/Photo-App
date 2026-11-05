# Local map data (photo-spot suggestions)

Suggestions are answered from a `Place` table (a copy of OpenStreetMap viewpoints, named peaks and attractions for the lower 48, Alaska,
Hawaii, Canada south of 76 N, Mexico, South Korea and Japan), not from the public Overpass servers, which often return 504/429 and take
25-60 s outside the local copy. Overpass is only asked when the search is outside the rings (`inLocalCoverage` in
`src/server/suggestions/local-places.ts`), or the local copy returns fewer than `MIN_LOCAL_PLACES` (5) places;
if Overpass then fails, the thin local answer is used. Overpass answers are also kept in the shared `SuggestionCache` table (A27).
Turso `Place` holds 203,679 rows (US, Canada, Mexico, South Korea, Japan). Import to Turso **before** pushing a coverage change.

- Build the data: `scripts/build-places.sh` (about 1 hour, 10 GB of downloads, needs `uv`) writes `data/places/*.jsonl` (git-ignored).
- Load it: `node scripts/import-places.mjs data/places --replace` (set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to load the live DB, otherwise `DATABASE_URL`).
- The table is created by migration `20261011120000_local_places`; until it is filled, searches behave exactly as before (Overpass).
- Refresh every few months. Relations (rare multipolygon attractions) are not included; ways use the centroid of their nodes.
- Other regions: `scripts/build-places-intl.sh` (Canada, Mexico) and `scripts/build-places-asia.sh` (South Korea, Japan), then `node scripts/import-places.mjs <dir>` (no `--replace`; upserts by id).
- Query shape (2026-10-09): a search is one database round trip however long the route. Cells are merged into runs read as `cell BETWEEN a AND b` terms (at most 100 per statement, extra statements run in parallel), corner cells outside a circle are skipped, and every cell read is remembered in memory for 30 minutes (`createCellReader`), so a nearby second search needs only the new cells. After a re-import a long-lived server may serve old cells for up to 30 minutes. Around-point results are ranked kind tier, named, then nearest first (routes: kind, named, id).
