# Sky preview and weather warning: design

Date: 2026-10-16
Status: draft, awaiting review

## Goal

Help photographers judge a stop before they drive there: show where the sun rises and sets and what the moon is doing,
and say plainly when the forecast makes a stop's chosen light unlikely to work.

## Scope

In scope:

1. A sun and moon preview for each stop: sunrise and sunset compass bearings, moon phase, moon illumination, moonrise.
2. That preview shown in two places: a compass card in the stop drawer, and direction lines on the map for the selected stop.
3. A plain-words weather warning badge on stops whose forecast gives the existing "poor" light rating.

Out of scope:

- A "best day this week" picker (dropped by the owner).
- Suggesting or applying changes (reordering stops, moving the trip date) when the weather is poor. The warning only warns.
- A sun-path arc on the map. Only the sunrise and sunset direction lines are drawn.
- Changing the existing thresholds that decide a "poor" rating.

## Existing code this builds on

- `suncalc` is already a dependency.
- `src/lib/best-time.ts` provides `getSunWindows`, `solarDayAnchor` and `solarDateAt`, which turn a planned date and a longitude into the correct solar day, and `formatClock` for times.
- `src/lib/weather.ts` provides `lightQuality(pref, summary)`: "poor" when rain chance is 50% or more or cloud cover is 80% or more, "good" under 50% cloud, otherwise "fair", and no rating for the "any" light preference.
- `src/lib/use-weather.ts` provides `weatherLine` and `useWeatherLine`, which already return `{ text, label, quality }` per stop and mark typical-weather results (past the forecast horizon) with the word "Typical".
- Stop UI lives in `src/components/editor/` (`StopList.tsx`, `StopDrawer.tsx`); the maps are `MapView.tsx` (Mapbox GL) and `FakeMapPanel.tsx` (offline preview, used when `NEXT_PUBLIC_MAP_FAKE=1`).

## Design

### 1. Sky math: `src/lib/sky.ts`

A pure module with no React and no network. For a stop's latitude and longitude and the trip's planned date it returns:

- `sunrise` and `sunset`: each a compass bearing in degrees clockwise from north (0 to 360) and the time, or null when the sun does not rise or set that day (polar day or night).
- `moon`: phase name (new, waxing crescent, first quarter, waxing gibbous, full, waning gibbous, last quarter, waning crescent), illumination as a percentage, and moonrise time or null when the moon does not rise that day.

Bearings convert from `suncalc`'s azimuth (measured from south, westward) to a compass bearing. The day is anchored with the same helpers the rest of the app uses, so the times agree with the stop list. A helper turns a bearing into a short compass word (N, NNE, and so on) for text.

### 2. Compass card in the stop drawer

A new component shown inside the stop drawer. It contains:

- An SVG compass dial with a marker for the sunrise bearing and one for the sunset bearing.
- Text for each: for example "Sunrise 6:52 AM, ENE 72°" and "Sunset 6:20 PM, WNW 288°".
- The moon phase name, illumination, and moonrise time.

The card needs no network, so it also works in offline-preview mode. In polar day or night it shows "Sun does not rise" or "Sun does not set" in place of the missing times. Colours come from the existing theme tokens so it works in light and dark mode.

### 3. Direction lines on the map

For the selected stop only, two lines start at the stop and point along the sunrise bearing and the sunset bearing. Each line has a short label. Line length is fixed in screen terms so the lines stay readable at any zoom.

- `MapView.tsx` draws them as a GeoJSON line layer, updated when the selection or date changes and removed when nothing is selected.
- `FakeMapPanel.tsx` draws equivalent simple SVG lines so the feature is testable offline.

### 4. Weather warning badge

When a stop has a light preference other than "any" and `weatherLine` reports `quality: "poor"`, a badge appears on the stop in the list and in the drawer. Wording names the light and the cause, using the forecast values already loaded for the stop, for example "Golden hour: 85% cloud, likely washed out" or "Sunset: rain likely".

- If the forecast is "typical" (past the forecast horizon), the badge says "Typically cloudy for golden hour" so it is not mistaken for a forecast.
- No badge for "good" or "fair" ratings, for stops with the "any" preference, or when the forecast is unavailable.
- The badge is informational and has no actions.

## Error handling

- Missing or failed weather data: no badge, as the existing weather text behaves.
- Invalid or missing coordinates or date: the sky card is not rendered. The sky math never throws for valid coordinates.
- Polar day or night: handled explicitly in the sky math and card.

## Testing

- Unit tests for `sky.ts`: known sunrise and sunset bearings at a few well-known locations and dates, the bearing conversion, compass words, the moon phase names at known new and full moon dates, and polar day and night.
- Unit tests for the badge wording: poor cloud, poor rain, typical forecast, and the cases that show no badge.
- Component tests for the compass card (normal and polar cases), the badge in the stop list and drawer, and the fake-map direction lines.
- One e2e check that opening a stop's drawer shows the compass card.

## Open items for the implementation plan

- Exact placement of the card within the drawer layout and the badge within the stop row.
- How `MapView.tsx` should add and remove the line layer given its current structure.
