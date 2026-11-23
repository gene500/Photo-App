import { expect, test, type Page } from "@playwright/test";
import { newTripViaForm, signUp } from "./helpers";

// Fake externals: a stop near (37.2, -119.5) is far from any road and gets a "Road end" 400 m away with a trail; a stop near
// (37, -119.5) has a hike and a real lot ("Fake Trailhead Lot"), which wins over a road end. The fake map's viewport is fixed.
const BOUNDS = { minLat: 36, maxLat: 38, minLng: -121, maxLng: -118 };
const at = (lat: number, lng: number) => ({ fx: (lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng), fy: (BOUNDS.maxLat - lat) / (BOUNDS.maxLat - BOUNDS.minLat) });

type ApiStop = { id: string; name: string; access: { name: string | null; kind?: string; trail?: unknown[] | null } | null };

async function stopsOf(page: Page, tripId: string): Promise<ApiStop[]> {
  const res = await page.request.get(`/api/trips/${tripId}`);
  expect(res.status()).toBe(200);
  return (await res.json()).trip.stops;
}

async function addStopAt(page: Page, lat: number, lng: number, count: number) {
  const box = (await page.getByTestId("map").boundingBox())!;
  const { fx, fy } = at(lat, lng);
  await page.getByTestId("map").click({ position: { x: box.width * fx, y: box.height * fy } });
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  await expect(page.getByTestId("stop-row")).toHaveCount(count);
}

test("a stop far from any road gets a road end and a dashed trail, stored for later opens; a stop with a lot keeps the lot", async ({ page }) => {
  await signUp(page, "e2e-trail");
  await newTripViaForm(page, "Trail access");
  const tripId = page.url().split("/").pop()!;

  await addStopAt(page, 37.2, -119.5, 1);
  await expect.poll(async () => (await stopsOf(page, tripId))[0].access?.name).toBe("Road end");
  const [stop] = await stopsOf(page, tripId);
  expect(stop.access?.kind).toBe("road-end");

  await page.getByRole("button", { name: /^Stop 1:/ }).click();
  await expect(page.getByRole("region", { name: "Selected stop" }).getByTestId("park-line")).toContainText(/Park at Road end, walk .* to /);
  await expect(page.getByRole("img", { name: `Parking for ${stop.name}: Road end` })).toBeVisible();
  await expect(page.getByTestId("access-trail")).toBeVisible();

  // Reopening reads the stored line and trail; it does not look the stop up again.
  const lookups: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && /^\/api\/stops\/[^/]+\/access$/.test(new URL(req.url()).pathname)) lookups.push(req.url());
  });
  await page.reload();
  await expect(page.getByTestId("stop-row")).toHaveCount(1);
  await page.getByRole("button", { name: /^Stop 1:/ }).click();
  await expect(page.getByRole("region", { name: "Selected stop" }).getByTestId("park-line")).toContainText(/Park at Road end, walk .* to /);
  await expect(page.getByTestId("access-trail")).toBeVisible();
  await page.waitForTimeout(1000);
  expect(lookups).toEqual([]);

  // A stop with a real lot keeps the lot: no road end and no trail for it.
  await addStopAt(page, 37, -119.5, 2);
  await expect.poll(async () => (await stopsOf(page, tripId))[1].access?.name).toBe("Fake Trailhead Lot");
  const second = (await stopsOf(page, tripId))[1];
  expect(second.access?.kind ?? "lot").not.toBe("road-end");
  await expect(page.getByTestId("access-trail")).toHaveCount(1);
});
