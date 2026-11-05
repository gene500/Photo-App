# Download PDF itinerary: design

Date: 2026-10-16
Status: draft, awaiting review

## Goal

Let a trip owner, or anyone with a share link, download a PDF of the trip to keep offline or print: a schedule of every stop
and a map of the route.

## Scope

In scope:

1. A "Download PDF" item in the editor's Export menu (shown when the trip has 2+ stops, like the other exports).
2. A "Download PDF" button on the public share page (`/s/[token]`).
3. A PDF made of a first page with trip summary and map, then the stop schedule across as many pages as needed.
4. A fallback map drawn by the app itself, used whenever the Mapbox static image cannot be loaded.

Out of scope:

- Shot checklists, uploaded photos, a print dialog, or any server-side PDF generation.
- Weather on the share page (viewers are not signed in and that page shows none today).
- Fonts for scripts outside Western European alphabets.

## Approach

- **Client-side, on click.** The PDF is built in the browser. Nothing is sent to the server.
- **Library: jsPDF 4.2.x**, pinned exactly, loaded with a dynamic `import()` inside the click handler so it is absent from
  every page load. Rejected: pdf-lib (unmaintained since 2022), pdfmake (ships its own fonts, much heavier).
- **Pure data first.** A builder turns the page's existing data into an `ItineraryInput`; a separate renderer turns that into
  a PDF. The builder and the map-URL function are pure and unit-testable without a browser.

## Components

### `src/lib/itinerary.ts` (pure)

- `ItineraryInput`: `{ tripName, plannedDate (string|null), startTime, totalDistanceKm, totalDriveMinutes, stops[] }`.
  Each stop: `{ index, name, arrival (formatted string), bestLight (string|null), weather (string|null), notes (string|null) }`.
- `buildItinerary(args): ItineraryInput` takes the same inputs the editor and share view already hold (stops, route, planned
  date, arrival times, optional weather lines, the viewer's 12/24-hour setting) and formats them. Times use the viewer's
  existing 12/24-hour formatter, so the PDF matches the screen.
- `itineraryFileName(tripName): string` returns `<slug>-itinerary.pdf`, falling back to `trip-itinerary.pdf` for an empty slug.

### `src/lib/static-map.ts` (pure)

- `staticMapUrl({ stops, geometry, token, width, height }): string | null` builds a Mapbox Static Images URL:
  `styles/v1/mapbox/outdoors-v12/static/<overlays>/auto/<w>x<h>@2x`, with an encoded-polyline `path` overlay (the route,
  downsampled with `downsampleRoute` until the URL is at most 7,500 characters) and numbered `pin-s-<n>` markers.
- Returns `null` when there is no token, fewer than 2 stops, or the URL cannot be brought under the limit.
- Size capped at 1280 x 1280 before `@2x`, as Mapbox requires.

### `src/lib/itinerary-pdf.ts` (browser only)

- `renderItineraryPdf(input, mapImage): Promise<Blob>` lays out page 1 (title, date and start time, distance and drive time,
  map image scaled to the page width) and the schedule (number, name, arrival time, best light, weather, notes), wrapping
  text and breaking to new pages with a "Page n of N" footer.
- `mapImage` is a JPEG/PNG data URL, or the output of the fallback map.
- `loadMapImage(url: string | null, fallback): Promise<string>` fetches the static map and converts it to a data URL; on a
  `null` URL, a non-OK response, a network error, or an 8-second timeout it returns the fallback.
- `drawFallbackMap(stops, geometry): string` draws the route line and numbered pins on a plain canvas and returns a data
  URL. No network.

### UI

- `ExportControl.tsx`: new menu item "Download PDF". While generating it shows "Preparing PDF..." and is disabled; on failure
  it shows a short error line and stays usable.
- `SharedTripView.tsx`: a "Download PDF" button near the trip title, same busy and error behavior.
- Both call one shared function, `downloadItineraryPdf(input, stops, geometry, token)`, that loads the map image, renders,
  and triggers the download through a temporary object-URL link.

## Content differences

| | Editor | Share page |
|---|---|---|
| Weather line | included where a forecast exists | omitted |
| Notes | stop notes | stop notes (as shown today) |
| Best light | included | included |

## Error handling

- No Mapbox token, fake map mode, or any map failure: fallback map, PDF still downloads.
- jsPDF fails to load or render: the control shows "Could not create the PDF. Try again." and logs the error to the console.
- Characters standard PDF fonts cannot draw (for example Chinese, Japanese, Arabic) are replaced with `?` rather than
  failing. This is a known limit of version 1.
- Each download costs one Mapbox static-image request. The spend cap already listed in `TODO.md` covers this.

## Security and headers

- The Mapbox token used is the existing public `pk.` token, as the map already uses. No new secrets.
- The static-image request goes to `https://api.mapbox.com`, already allowed by the CSP for images and connections.
- The share page sends `no-referrer`; if the token is URL-restricted in Mapbox this can make the static request fail, which
  is covered by the fallback. Verify against the live site after deploy.

## Testing

- Unit: `buildItinerary` (ordering, time formats, null weather, empty notes), `itineraryFileName`, `staticMapUrl` (overlay
  encoding, downsampling to stay under the length limit, `null` cases).
- PDF: `renderItineraryPdf` with a tiny fixture returns a Blob beginning `%PDF`, with the stop names present in its text and
  a page count that grows with 40 stops.
- Component: menu item present with 2+ stops and absent with fewer; share button present; busy and error states.
- E2E (Playwright, fake map mode): click Download PDF in the editor and on a share page, assert a download named
  `*-itinerary.pdf` starts and is non-empty.
- Manual: with the real token, download once from the editor and once from a share page and inspect both PDFs, including a
  forced failure of the static request to confirm the fallback.

## Review focus

- A trip with 40+ stops: schedule paginates and the static-map URL stays under the limit.
- A very long route geometry: downsampling keeps the shape recognizable.
- Stops with empty names or no notes: no blank labels or `undefined` text.
- Long names and notes: wrapped, not clipped.
- Clicking twice quickly: one download, not two.
