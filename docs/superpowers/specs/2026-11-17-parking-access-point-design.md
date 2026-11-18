# Drive to the parking lot, show the trail from there (design)

Date: 2026-11-17. Status: draft for owner approval. Owner: the app's owner (they/them).

## Intent and why

Today the driving route and Optimize's drive times go to a stop's own coordinates. For a summit, arch or viewpoint
that is often miles of trail away from where a car can stop. Owner request: "go to its parking lot and show the trail
from there." So the car route ends at the stop's parking lot, and the walk (already drawn as a dotted line) starts there.

## Goals

- A stop that has a hike gets an **access point**: the parking lot nearest the start of its trail. Driving routes,
  Optimize drive times, the share page route and the PDF use it instead of the stop's coordinates.
- The hike line and its distance start at the parking lot ("Park at X, walk 1.2 mi to Y").
- The access point is **saved on the stop**, so a route does not change from one run to the next when a free map
  service is slow, and it works on the share page and in offline copies.
- Existing stops pick up an access point the first time their trip is opened.

## Non-goals

- No editing UI for the access point in this change (no "pick a different lot"). It can be re-resolved by moving the stop.
- No turn-by-turn directions, parking availability, fees, or opening hours.
- No change to stops that have no hike (they route to their own coordinates as today).
- No change to photo matching, suggestions, light windows or dwell times.

## Anti-goals (would make this a failure even if it works)

- A route that silently changes between runs because a lookup failed.
- Routing to a lot that is farther from the stop than the stop's own road access would be (wrong lot = worse than today).
- Slower route, Optimize or page loads from live map-service calls on the critical path.

## Constraints

- Prisma + libsql (Turso in production): a new migration in `prisma/migrations`, applied like earlier ones (see
  docs/HANDOFF.md). Columns must be nullable so old rows and old clients keep working.
- Overpass and NPS are free services, slow at times: lookups must be bounded in time, cached, and never block saving a stop.
- `POST /api/directions` takes coordinates from the client; `optimize` and the share page build coordinates from
  stored stops on the server. Both must end up using the same point.
- Attribution must stay on screen while trail data is drawn (existing hike rules in docs/design/A53-DESIGN.md).
- Privacy pages: no new data leaves the app (same Overpass/NPS lookups as the hike line), so no legal wording change
  expected; the daily legal review still runs before a push.
- Tests, typecheck, lint and e2e must pass; fake externals (`EXTERNAL_APIS_FAKE=1`) must give a fake parking point.

## Approaches considered

- **A. Look it up whenever a route is built.** Nothing stored, smallest change, but routes change when Overpass
  hiccups and every route call gets slower. Rejected.
- **B. The browser sends the parking point.** The editor only knows the hike of the selected stop; the share page and
  offline copy would still route to the summit. Rejected.
- **C. Save the access point on the stop (chosen by the owner).** Resolve once on create/move with the existing hike
  lookup, store two nullable columns, and have every consumer read them. More work, but stable, fast and offline-safe.

## Design (decided)

**Data.** `Stop` gets nullable `accessLat`, `accessLng` (Float). Mapped to the client `Stop` type as an optional
`access: { lat, lng } | null`. Validated server-side like `lat`/`lng` (range checks); never accepted from the client
on create/update in this change (server-resolved only), to keep it simple and safe.

**Resolving.** A server function `resolveAccessPoint(lat, lng)` reuses the hike lookup. The result is the start of the
hike geometry when the chosen start is a parking lot. Parking is preferred over trailhead markers (owner: "parking
lot"); if there is no parking but there is a trailhead, use the trailhead as the access point (my call, flagged below).
Rules (my calls, owner can change):
- If the access point is within 150 m of the stop, store null (no detour for a short walk).
- If no hike or no parking/trailhead is found, store null and the route goes to the stop as today.
- Looked up when a stop is added or moved, after the stop is saved (a slow or failed lookup never blocks saving). A
  failed lookup leaves the columns null and is retried the next time the trip is opened (bounded: at most once per
  stop per trip open, at most 3 lookups in flight).
- Existing stops: resolved lazily the first time their trip is loaded after deploy, same retry rule.
- Moving a stop clears and re-resolves its access point.

**OSM query.** The current Overpass query finds only parking drawn as a single point (`node[amenity=parking]`). Many
lots are drawn as areas, so extend it to include `way`/`relation` parking (use the centre point of the area, e.g.
`out center`). Keep result size bounded (existing 6 MB cap, 2.5 km radius).

**Hike line.** The hike geometry starts at the access point (the lookup already starts from the best trailhead tier;
the tiers change to parking first, then trailheads), so the drawn trail and distance match the drive end.

**Consumers.** One helper `routePoint(stop)` returns the access point when set, else the stop's own coordinates.
Use it for: the editor's directions request, `optimize` (matrix coordinates and arrival times), the share page route,
the itinerary PDF and text export (drive legs), and map route drawing. Stop markers stay at the stop's own position;
add a small parking marker at the access point on the selected stop. Trip distance and drive time totals use the new route.

**Itinerary text.** For a stop with an access point: "Park at <lot name or 'parking'>, walk 1.2 mi to <stop>". The lot
name is used only if OSM has one.

**Fakes and tests.** `fakeHike` returns a start offset ~400 m from the stop, so e2e can assert the route ends at the
parking point. Unit tests: resolver rules (150 m rule, parking over trailhead, area parking), `routePoint`, migration
default, optimize uses access points, share page route, PDF/itinerary text. e2e: add a stop, route ends at the
parking marker, the dotted trail starts there, share page matches.

## Open points (my calls; owner confirmed all three on 2026-11-17: "all of them look good")

1. Trailhead fallback when no parking exists: I use the trailhead. The owner said "parking lot"; say so if a stop with
   no parking should instead route to itself.
2. 150 m threshold for "short walk" is a guess.
3. No manual override of the lot in this change.

## Calls made after the builder check (owner to check; they supersede anything above that disagrees)

1. **Only real lots/trailheads count.** The hike path falls back to a trail dead end when nothing snaps; a dead end is
   not a place to park, so it is never an access point. The resolver does its own OSM search for parking (nodes, ways,
   relations; `out center`) and trailheads around the stop, for NPS hikes too (NPS trail geometry still draws the
   walk, OSM supplies the lot). A lot only counts if it is within 150 m of a trail (the existing snap distance).
2. **No live drive-time check.** Acceptance rule: lot within the 2.5 km search radius of the stop and within 150 m of
   the trail, nearest first. Known limit: the lot can be on a different road; accepted, no extra Directions call.
3. **Hike line changes for everyone, as intended.** Preference order becomes parking first, then trailhead markers;
   the walk is drawn from the chosen lot even if a trailhead marker is closer (the owner asked for "from the parking
   lot"). Existing hike tests and fixtures are updated to match.
4. **Third column `accessName`** (nullable text, OSM `name` tag, trimmed, max 120 chars) so the share page, PDF and
   offline copy can say "Park at <name>".
5. **Fourth column `accessResolvedAt`** (nullable DateTime). Null means never tried; set when a lookup finished,
   with or without a lot, so stops with no lot are not looked up again on every open. A failed lookup (service down)
   leaves it null and is retried on the next open. Moving a stop clears all four columns.
6. **How the app receives the late result.** A new owner-only `POST /api/stops/:id/access` resolves and saves the
   access point and returns the updated stop. The editor calls it after a stop is added or moved, and for stops
   whose `accessResolvedAt` is null when a trip opens (3 at a time). Until it answers, the route goes to the stop
   itself; when it answers, the route is redrawn. Share-page viewers and the share page never trigger resolves or writes.
7. **Existing tests/fixtures may change** (routes and walk lengths shift because the fake lot is ~400 m from the stop).

## Left to the builder

Exact column/type names in code, migration SQL, how the lazy resolve is triggered on trip load, UI styling of the
parking marker, and exact copy of the itinerary line within the format above.
