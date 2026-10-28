import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./helpers";

// Stops at the same place (or ~5 m apart) are fanned out on the map so each marker can be hit and clicked;
// a stop far from them is not displaced.
async function signupTrip(page: Page, prefix: string) {
  await signUp(page, prefix);
  await page.getByLabel("Trip name").fill("Fan out");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  return page.url().split("/").pop()!;
}

/** The same search result added `count` times (a phone: on desktop that place sits under the left panel in the fake map). */
async function addSearchResult(page: Page, count: number) {
  const rows = page.getByTestId("stop-row");
  for (let i = 0; i < count; i++) {
    await page.getByRole("combobox", { name: "Search for a place" }).fill("Alpha Town");
    await page.getByRole("option", { name: "Alpha Town (fake)" }).click();
    await page.getByRole("button", { name: "Add stop" }).click();
    await expect(rows).toHaveCount(i + 1);
  }
}

/** Every marker matching `name` is the topmost element at its own centre and no two centres are closer than 30 px. */
async function expectHittable(page: Page, name: RegExp, expected: number) {
  const all = page.getByTestId("map").getByRole("button", { name });
  await expect(all).toHaveCount(expected);
  const centres: { x: number; y: number }[] = [];
  for (let i = 0; i < expected; i++) {
    const b = (await all.nth(i).boundingBox())!;
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    const hit = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.getAttribute("aria-label") ?? null, [x, y]);
    expect(hit).toBe(await all.nth(i).getAttribute("aria-label"));
    centres.push({ x, y });
  }
  for (let i = 0; i < expected; i++) for (let j = i + 1; j < expected; j++) expect(Math.hypot(centres[i].x - centres[j].x, centres[i].y - centres[j].y)).toBeGreaterThanOrEqual(30);
}

/** Clicking each marker selects exactly that one (the card is closed in between, since it can sit over the map on a phone). */
async function expectEachOpensItsCard(page: Page, name: RegExp, order: number[]) {
  const all = page.getByTestId("map").getByRole("button", { name });
  for (const i of order) {
    const b = (await all.nth(i).boundingBox())!;
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await expect(page.getByRole("region", { name: "Selected stop" })).toBeVisible();
    await expect(all.nth(i)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("map").locator("[aria-pressed=true]")).toHaveCount(1);
    await page.getByRole("region", { name: "Selected stop" }).getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("region", { name: "Selected stop" })).toBeHidden();
  }
}

test("three stops at identical coordinates are each hittable and open their own card (desktop)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const tripId = await signupTrip(page, "e2e-fan-d");
  for (const name of ["Same A", "Same B", "Same C"]) {
    const r = await page.request.post(`/api/trips/${tripId}/stops`, { data: { name, lat: 37.1, lng: -118.9, source: "manual" } });
    expect(r.status()).toBe(201);
  }
  await page.reload();
  await expect(page.getByTestId("stop-row")).toHaveCount(3);
  await expectHittable(page, /^Stop \d+:/, 3);
  await expectEachOpensItsCard(page, /^Stop \d+:/, [2, 0, 1]);
});

test("three stops at identical coordinates are each hittable and open their own card (phone portrait, same search result)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await signupTrip(page, "e2e-fan-p");
  await addSearchResult(page, 3);
  await expectHittable(page, /^Stop \d+: Alpha Town/, 3);
  await expectEachOpensItsCard(page, /^Stop \d+: Alpha Town/, [2, 0, 1]);
});

test("stops about 5 m apart are fanned out, and a far-apart stop is not displaced", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const tripId = await signupTrip(page, "e2e-fan-far");
  // 0.00005 degrees of latitude is about 5.5 m; the far stop is a whole degree away. All inside the fake map's bounds.
  for (const [name, lat, lng] of [["Far", 37.5, -118.5], ["Near A", 36.6, -119.2], ["Near B", 36.60005, -119.2], ["Near C", 36.6, -119.20005]] as const) {
    const r = await page.request.post(`/api/trips/${tripId}/stops`, { data: { name, lat, lng, source: "manual" } });
    expect(r.status()).toBe(201);
  }
  await page.reload();
  await expect(page.getByTestId("stop-row")).toHaveCount(4);
  const far = page.getByTestId("map").getByRole("button", { name: /^Stop 1: Far/ });
  const box = (await far.boundingBox())!;
  const map = (await page.getByTestId("map").boundingBox())!;
  // Unfanned position: bounds 36..38 lat, -121..-118 lng, marker centred on its point.
  expect(Math.abs(box.x + box.width / 2 - (map.x + map.width * ((-118.5 + 121) / 3)))).toBeLessThan(1);
  expect(Math.abs(box.y + box.height / 2 - (map.y + map.height * ((38 - 37.5) / 2)))).toBeLessThan(1);
  await expectHittable(page, /^Stop [234]:/, 3);
  await expectEachOpensItsCard(page, /^Stop [234]:/, [1, 2, 0]);
});
