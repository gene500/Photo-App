# A63: closures and opening hours for Optimize (free data)

Goal: Optimize tells the owner about park/road closures and opening hours at their stops, from free data, without ever
blocking or failing. Notices are advisory only: the optimizer order is NOT changed by them (no time windows yet).

## Research (official docs; verified 2026-10-29)

### NPS Data API (https://www.nps.gov/subjects/developer/)
- Free, but a personal 40-character key is required ("Get started": https://www.nps.gov/subjects/developer/get-started.htm).
  Sent as the `X-Api-Key` header (or `api_key` query parameter). We use the header so the key never appears in URLs/logs.
  Guide: https://www.nps.gov/subjects/developer/guides.htm
- Rate limit: default 1,000 requests/hour per key (rolling window), headers `X-RateLimit-Limit` / `X-RateLimit-Remaining`;
  over the limit gives HTTP 429 and a temporary block.
- Terms/attribution: the guide gives no attribution format and refers to the NPS site disclaimer. We label notes "(NPS alert)".
- `/parks` (lat/long as strings, `parkCode`, `fullName`), `/alerts?parkCode=a,b&limit=` (fields `title`, `category`,
  `parkCode`, `description`, `url`; paginated with a zero-based `start`, 50 per page by default).
- NOT verified in official pages (the interactive docs could not be read): the exact category strings. Third-party
  sources list `Park Closure`, `Caution`, `Danger`, `Information`. The code matches `Park Closure` case-insensitively and
  otherwise needs road/trail closure wording in the title, so a differing category name degrades to fewer notices, not wrong ones.
  Also unverified: how fresh alerts are (official changelog: every 2 h since 2017; a third party says nightly).
- `operatingHours` in `/parks` is park-wide (visitor centres, seasons), not per stop, so it is NOT used.

### OpenStreetMap Overpass (https://wiki.openstreetmap.org/wiki/Overpass_API)
- Public main instance `overpass-api.de`: fine for light use (under ~10,000 queries and 1 GB per day; "regular use" should be
  far lower), must identify the app with a `User-Agent`/`Referer`, no parallel scripts, cache, and wait 30 s after HTTP 429 or 406.
  Commercial/heavy use needs a self-hosted or paid instance. Reliability is not guaranteed.
- Our use: one batched POST per Optimize run for stops not already cached (max 15 stops, `around:40` metres, `["opening_hours"]`),
  descriptive `User-Agent` (`RoadTripPhotoPlanner/1.0 (...)`), 24 h cache per coordinate, 5 min failure cache,
  30 s back-off after 429/406. `OVERPASS_URL` overrides the endpoint (same variable the suggestions code uses).
- Data is ODbL (c) OpenStreetMap contributors; notes carry "(OpenStreetMap)". Only derived short text is shown.
- Weak spot: the 40 m match can pair a stop with a neighbouring feature. Hours only ever produce a "probably closed" note.

### Other sources (not built)
- State DOT 511 / traveler-information feeds exist per state (many need a free key, formats differ). Too fragmented for
  the smallest useful version. Possible later, one state at a time.
- NPS "Park Closure" alerts and road closure titles (e.g. "Tioga Road closed") already cover the headline cases for national parks.
- NPS also publishes `/roadevents` (road events) in the API; not verified, so not used.

## Decision
Build NPS alerts + OSM hours as non-blocking notices.

- `src/server/external/nps-alerts.ts`: parks list (24 h cache) + alerts per park (1 h cache), in-flight de-duplication,
  failure cache 5 min. Matches a stop to the nearest park centre within 35 km; alerts are shown only for trips planned
  from yesterday to 14 days ahead (alerts describe today). Skipped entirely without `NPS_API_KEY`.
- `src/server/external/osm-hours.ts`: batched Overpass lookup, described above.
- `src/lib/opening-hours.ts`: parses only simple patterns (`24/7`, `Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off`, several
  ranges, later rules override). Anything else (holidays, months, sunrise, `+`, week numbers) is ignored. No time-zone
  database is bundled, so local time is the mean solar time from the longitude. "Closed" is only reported when the
  estimated arrival is more than 60 min outside the hours (or the weekday is not listed); within 60 min it says "Check the hours".
  "Hours unknown" is never shown.
- `src/server/external/place-notices.ts`: orchestrates both under a 3 s deadline (each source raced separately, so one slow
  source does not drop the other); never throws; `EXTERNAL_APIS_FAKE=1` returns canned notices (no network).
- `POST /api/optimize` adds `notices: { stopIndex, kind: "closed" | "hours" | "alert", text, source }[]` (omitted when empty).
  Arrival estimates come from the chosen order, the matrix durations and the dwell times. Only coordinates, the arrival
  time (for the local check, not sent upstream) and the date are used; no user data leaves the server.
- Editor: notes appear in the Optimize status as `Stop name: text.` (max 5, then "N more heads-ups for your stops"), visited stops skipped.
- The optimizer itself is unchanged (a per-stop time window was not trivial to do safely; deferred).

## Owner actions
1. Create a free NPS key (https://www.nps.gov/subjects/developer/get-started.htm) and set `NPS_API_KEY` in the Vercel project
   (Production and Preview) and in local `.env`. Without it the NPS part is silently skipped; OSM hours still work.
2. Optionally set `OVERPASS_URL` to a self-hosted/paid instance if usage grows.
3. Consider whether the 1,000 requests/hour NPS allowance (shared by all users, 2 calls per cold cache) is enough; the caches
   are per server instance, so many serverless instances multiply cold calls.

## Limits and follow-ups
- Caches are in memory per instance (like weather), not in the database.
- Alerts are not date-specific beyond the 14-day horizon; the alert text may describe a past/future period.
- Possible later: per-stop time windows in the optimizer, state 511 feeds, a shared DB cache.
