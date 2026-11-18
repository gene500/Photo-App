import { expect, test, type Page } from "@playwright/test";
import { newTripViaForm, signUp } from "./helpers";

// Fake externals: a stop near the middle of the fake map (37, -119.5) has a hike and a parking lot ("Fake Trailhead Lot", about
// 1.9 km away); a stop elsewhere has neither and routes to itself. The fake map's viewport is fixed, so lat/lng map to percentages.
const BOUNDS = { minLat: 36, maxLat: 38, minLng: -121, maxLng: -118 };
const pct = (p: { lat: number; lng: number }) => ({ left: ((p.lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * 100, top: ((BOUNDS.maxLat - p.lat) / (BOUNDS.maxLat - BOUNDS.minLat)) * 100 });

type ApiStop = { id: string; name: string; lat: number; lng: number; access: { lat: number; lng: number; name: string | null; walkMeters: number } | null };

async function stopsOf(page: Page, tripId: string): Promise<ApiStop[]> {
  const res = await page.request.get(`/api/trips/${tripId}`);
  expect(res.status()).toBe(200);
  return (await res.json()).trip.stops;
}

/** The first and last points of a polyline's `points` attribute, as map percentages. */
async function ends(page: Page, testId: string) {
  const pts = (await page.getByTestId(testId).first().getAttribute("points"))!.trim().split(/\s+/).map((p) => p.split(",").map(Number));
  return { first: { left: pts[0][0], top: pts[0][1] }, last: { left: pts[pts.length - 1][0], top: pts[pts.length - 1][1] } };
}

function expectNear(a: { left: number; top: number }, b: { left: number; top: number }) {
  expect(a.left).toBeCloseTo(b.left, 2);
  expect(a.top).toBeCloseTo(b.top, 2);
}

test("a stop with a hike drives to its parking lot; a stop without one routes to itself; moving it re-resolves", async ({ page, browser }) => {
  await signUp(page, "e2e-parking");
  await newTripViaForm(page, "Parking route");
  const tripId = page.url().split("/").pop()!;

  const directionsBodies: number[][][] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === "/api/directions") directionsBodies.push(JSON.parse(req.postData() ?? "{}").coordinates);
  });

  const rows = page.getByTestId("stop-row");
  // Stop 1 at the hike point (the middle of the map), stop 2 far away.
  await page.getByTestId("map").click();
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  await expect(rows).toHaveCount(1);
  await page.getByTestId("map").click({ position: { x: 900, y: 120 } });
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  await expect(rows).toHaveCount(2);

  // The editor resolves the lot by itself and saves it on the stop.
  await expect.poll(async () => (await stopsOf(page, tripId))[0].access?.name).toBe("Fake Trailhead Lot");
  const [near, far] = await stopsOf(page, tripId);
  const lot = near.access!;
  expect(far.access).toBeNull();
  expect(lot.walkMeters).toBeGreaterThan(500);
  expect(Math.abs(lot.lat - near.lat) + Math.abs(lot.lng - near.lng)).toBeGreaterThan(0.005);

  // Every stop's lot has a marker with a visible label, at the lot, selected or not; the stop with no lot has none.
  const marker = page.getByRole("img", { name: `Parking for ${near.name}: Fake Trailhead Lot` });
  await expect(marker).toBeVisible();
  await expect(marker).toContainText("Fake Trailhead Lot");
  await expect(page.getByRole("img", { name: /^Parking for/ })).toHaveCount(1);
  const markerStyle = (await marker.getAttribute("style"))!;
  const left = Number(/left:\s*([\d.]+)%/.exec(markerStyle)![1]);
  const top = Number(/top:\s*([\d.]+)%/.exec(markerStyle)![1]);
  expectNear({ left, top }, pct(lot));
  // Selecting the stop emphasises its marker (the same element); selecting the other stop does not remove it.
  await expect(marker).not.toHaveClass(/lot-marker-selected/);
  await page.getByRole("button", { name: /^Stop 1:/ }).click();
  await expect(marker).toHaveClass(/lot-marker-selected/);
  // The editor says where to park: stop card and My trip list.
  await expect(page.getByRole("region", { name: "Selected stop" }).getByTestId("park-line")).toContainText(`Park at Fake Trailhead Lot, walk`);
  await page.getByRole("tab", { name: "My trip" }).click();
  await expect(page.getByTestId("trip-row").first().getByTestId("park-line")).toContainText(`to ${near.name}`);
  await page.getByRole("tab", { name: "Stops" }).click();
  await page.getByRole("button", { name: /^Stop 2:/ }).click();
  await expect(marker).toBeVisible();
  await expect(marker).not.toHaveClass(/lot-marker-selected/);
  await expect(page.getByRole("img", { name: /^Parking for/ })).toHaveCount(1);

  // The drive request ends at the lot for stop 1 and at the stop itself for stop 2.
  await expect.poll(() => {
    const last = directionsBodies.at(-1);
    return last?.length === 2 ? last[0] : null;
  }).toEqual([expect.closeTo(lot.lng, 5), expect.closeTo(lot.lat, 5)]);
  const body = directionsBodies.at(-1)!;
  expect(body[1]).toEqual([expect.closeTo(far.lng, 5), expect.closeTo(far.lat, 5)]);
  expect(Math.abs(body[0][0] - near.lng) + Math.abs(body[0][1] - near.lat)).toBeGreaterThan(0.005);

  // The editor draws the route line only after Optimize (covered by optimize-route.spec.ts); the request above is what it routes with.
  // The dotted hike starts at the lot.
  await page.getByRole("button", { name: /^Stop 1:/ }).click();
  await expect(page.getByTestId("hike-line")).toHaveCount(1);
  expectNear((await ends(page, "hike-line")).first, pct(lot));

  // The share page fetches its route on the server (no browser request to watch), so check the line it draws and the lot it names.
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Create link" }).click();
  const url = await page.getByLabel("Share link").inputValue();
  const stranger = await browser.newContext();
  try {
    const shared = await stranger.newPage();
    expect((await shared.goto(url))?.status()).toBe(200);
    await expect(shared.getByTestId("shared-stop")).toHaveCount(2);
    const sharedRoute = await ends(shared, "route-line");
    expectNear(sharedRoute.first, pct(lot));
    expectNear(sharedRoute.last, pct(far));
    await expect(shared.getByText(/Park at Fake Trailhead Lot/).first()).toBeVisible();
    await expect(shared.getByRole("img", { name: `Parking for ${near.name}: Fake Trailhead Lot` })).toContainText("Fake Trailhead Lot");
  } finally {
    await stranger.close();
  }

  // Moving the stop clears the saved lot at once; the editor then finds the new one (next to the new spot).
  const moved = { lat: near.lat + 0.02, lng: near.lng + 0.02 };
  const patch = await page.request.patch(`/api/stops/${near.id}`, { data: moved });
  expect(patch.status()).toBe(200);
  expect((await patch.json()).stop.access).toBeNull();
  expect((await stopsOf(page, tripId))[0].access).toBeNull();
  await page.reload();
  await expect.poll(async () => (await stopsOf(page, tripId))[0].access?.name).toBe("Fake Trailhead Lot");
  const relot = (await stopsOf(page, tripId))[0].access!;
  expect(relot.lat).not.toBeCloseTo(lot.lat, 3);
  expect(relot.lat - moved.lat).toBeLessThan(0.03);

  // Moving it out of reach of the hike leaves it with no lot (resolved, nothing found) and the route goes to the stop.
  const away = await page.request.patch(`/api/stops/${near.id}`, { data: { lat: 36.3, lng: -120.5 } });
  expect((await away.json()).stop.access).toBeNull();
  await page.reload();
  await expect(rows).toHaveCount(2);
  const resolved = await page.request.post(`/api/stops/${near.id}/access`);
  expect(resolved.status()).toBe(200);
  expect((await resolved.json()).stop.access).toBeNull();
  await expect.poll(() => {
    const last = directionsBodies.at(-1);
    return last?.length === 2 ? last[0] : null;
  }).toEqual([expect.closeTo(-120.5, 5), expect.closeTo(36.3, 5)]);
});

const clockMinutes = (text: string) => {
  const m = /(\d{1,2}):(\d{2})\s*([AP]M)/.exec(text)!;
  return ((Number(m[1]) % 12) + (m[3] === "PM" ? 12 : 0)) * 60 + Number(m[2]);
};

test("the walk from the lot is in the plan: park line shows the minutes, the subject is reached a walk after the lot, the next stop is later by two walks", async ({ page }) => {
  await signUp(page, "e2e-parking-walk");
  await newTripViaForm(page, "Walk time");
  const tripId = page.url().split("/").pop()!;
  const rows = page.getByTestId("stop-row");
  await page.getByTestId("map").click();
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  await expect(rows).toHaveCount(1);
  await page.getByTestId("map").click({ position: { x: 900, y: 120 } });
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  await expect(rows).toHaveCount(2);
  await expect.poll(async () => (await stopsOf(page, tripId))[0].access?.name).toBe("Fake Trailhead Lot");
  const [near, far] = await stopsOf(page, tripId);
  const lot = near.access!;
  // The fake lot walk is about 1920 m: 30 minutes one way (4 km/h, rounded up to 5).
  expect(lot.walkMeters).toBeGreaterThan(1800);
  expect(lot.walkMeters).toBeLessThan(2000);

  // Fix the start (the time at the first stop's lot) at 8:00 and optimize so the route and the times exist.
  await page.getByRole("tab", { name: "My trip" }).click();
  await page.getByRole("button", { name: "Optimize route" }).click();
  const startTime = page.getByLabel("Start time");
  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && /\/api\/trips\/[^/]+$/.test(r.url()));
  await startTime.fill("08:00");
  await startTime.blur();
  await saved;
  await expect(page.getByTestId("trip-row").first().getByTestId("park-line")).toContainText(/Park at Fake Trailhead Lot, walk \d+\.\d mi \(~30 min\) to /);

  await page.getByRole("tab", { name: "Stops" }).click();
  const card = page.getByRole("region", { name: "Selected stop" });
  await page.getByRole("button", { name: /^Stop 1:/ }).click();
  await expect(card.getByText(/^Arrive ~/)).toBeVisible();
  const first = clockMinutes((await card.getByText(/^Arrive ~/).textContent())!);
  await page.getByRole("button", { name: /^Stop 2:/ }).click();
  await expect(card.getByText(/^Arrive ~/)).toBeVisible();
  const second = clockMinutes((await card.getByText(/^Arrive ~/).textContent())!);

  // Subject of stop 1: the lot at 8:00 plus a 30 min walk.
  expect(first).toBe(8 * 60 + 30);
  // Stop 2: 8:00 + walk there (30) + dwell (30) + walk back (30) + the drive from the lot, i.e. two walks more than a stop without a lot.
  const route = await page.request.post("/api/directions", { data: { coordinates: [[lot.lng, lot.lat], [far.lng, far.lat]] } });
  expect(route.status()).toBe(200);
  const driveMin = (await route.json()).route.legs[0].duration / 60;
  expect(Math.abs(second - (8 * 60 + 90 + driveMin))).toBeLessThanOrEqual(1.01);
});
