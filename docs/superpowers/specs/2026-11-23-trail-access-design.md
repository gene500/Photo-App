# Road end and trail for stops with no parking lot (design)

Date: 2026-11-23. Status: owner direction given; design calls below are the assistant's, open for the owner to change. Task F3.

## Intent and why

In a new Arches National Park trip (7 stops) Optimize draws a route that stops short of some stop markers. Cause (reproduced 2026-11-23, 2 Mapbox calls): the stops sit on foot trails, 1,071 m (Delicate Arch) and 1,559 m (Landscape Arch) from the nearest road. The route request sends the stop's own coordinates, Mapbox snaps them to the nearest road at any distance, and the drawn line ends at that road point with nothing joining it to the marker. The parking-lot feature (2026-11-17) did not cause this: with no lot found, routing is byte-identical to before it. Stops in Arches are simply farther from roads than the earlier Yosemite trips.

The owner's direction (2026-11-23): "have it go to the nearest road with a trail that leads to the stop".

## Goals

- A stop with no parking lot is routed to the nearest road point ("road end"), not silently snapped.
- A trail from the road end to the stop is drawn on the map (distinct, dashed, readable on the beige map), so the line always visibly reaches the marker.
- The road end acts like a parking lot everywhere a lot already does: the stop card line ("Park at <name>, walk N"), drive-time matrix for Optimize, share page, PDF, Maps links, walk time in the schedule.
- If no trail is found, draw a straight dashed line and say so on the stop ("no mapped trail").

## Non-goals

- Replacing real parking lots: a resolved lot always wins.
- Turn-by-turn walking directions, elevation, or trail difficulty.
- Changing the Optimize algorithm.

## Anti-goals

- Do not spend a Mapbox call per stop per page view; the road end and trail are looked up once per stop and stored, like the lot (`access`).
- Must not make stops near roads worse: a stop within about 100 m of a drivable road keeps today's behaviour.
- Do not break the 80% budget rules (task A7): any Mapbox call added is counted through `spendBudget` / `spendUserShare`.

## Constraints

- Reuse the saved access point (`access`: lat/lng, name, walk length) and its lookup `POST /api/stops/:id/access`, the `routePoint` / `routePoints` helpers, the `P` marker and park line. A road end is an access point with a name like "Road end" and no lot flag if one is needed.
- Free data first: the lot lookup already uses OpenStreetMap Overpass. Finding the nearest drivable road and a connecting trail from OSM costs no Mapbox quota. Mapbox walking Directions (counts as a Directions unit) is the fallback for the trail line.
- Mapbox free allowances and caps are in `src/server/budget-config.ts`.
- Privacy/terms pages: reviewed in the same pass as A7 (no new personal data is stored beyond a stop's road-end point, which is the same kind of data as the saved lot).
- Never print or commit secrets.

## Approaches considered

- **A. Road end stored as an access point, trail from OSM with Mapbox walking as fallback (picked).** One concept (access point) everywhere; no repeated calls; Optimize orders by real drive times to the road.
- **B. Draw-time only: dashed straight connector from the Directions snap point to the marker.** Cheap, no storage, but no trail, Optimize still uses off-road distances, no walk time.
- **C. Warn "no road access" only.** Honest but leaves the line broken and does not do what the owner asked.

## Decisions made

- Owner: the route goes to the nearest road and a trail leads from there to the stop.

## Calls (assistant's, not agreed with the owner)

- Threshold: a stop more than 100 m from a drivable road with no lot gets a road end; closer stops keep the current behaviour.
- The road end and trail are found when the access lookup runs (after a stop is added and when a trip opens, as for lots) and stored on the stop.
- The trail is drawn dashed in the route-line family colour, thinner than the route, under the markers.
- Walk time uses the existing 4 km/h estimate over the trail length (as for lots).
- A lookup that fails (service down) saves nothing and is retried, exactly like the lot lookup; it is never treated as "no road".

## Left to the builder

- Exact Overpass queries for nearest drivable road and trail; how the trail geometry is stored (a small polyline on the stop's access record) and the migration it needs.
- How the share page and PDF draw the trail.
- Tests: Arches-like fixture (stop 1 km from a road), stop near a road (unchanged), no trail found (straight line plus note), lookup failure retried.
