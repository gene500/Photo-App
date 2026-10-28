import { expect, test, type Page } from "@playwright/test";

// Visited stops stay first and in place: their handles are disabled, drops on them land at the first unvisited slot,
// keyboard moves never pass them, and the server normalises a reorder request that moves one.
const NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];

async function setup(page: Page, prefix: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`${prefix}-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  const res = await page.request.post("/api/trips", { data: { name: "Visited order", plannedDate: "2026-07-01" } });
  expect(res.status()).toBe(201);
  const tripId = (await res.json()).trip.id as string;
  const ids: string[] = [];
  for (const [i, name] of NAMES.entries()) {
    const r = await page.request.post(`/api/trips/${tripId}/stops`, { data: { name, lat: 36.5 + i * 0.3, lng: -120.5 + i * 0.4, source: "manual" } });
    expect(r.status()).toBe(201);
    ids.push((await r.json()).stop.id);
  }
  for (const id of ids.slice(0, 2)) {
    const r = await page.request.patch(`/api/stops/${id}`, { data: { visited: true } });
    expect(r.ok()).toBeTruthy();
  }
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByTestId("stop-row")).toHaveCount(5);
  return { tripId, ids };
}

const order = (page: Page) => page.getByTestId("stop-row").evaluateAll((els) => els.map((e) => (e.querySelector("button")?.textContent ?? "").replace(/^\d+\.\s*/, "").trim()));
const serverOrder = async (page: Page, tripId: string) => ((await (await page.request.get(`/api/trips/${tripId}`)).json()).trip.stops as { name: string }[]).map((s) => s.name);

async function kbd(page: Page, from: number, keys: string[]) {
  const handle = page.getByTestId("stop-row").nth(from).getByTestId("drag-handle");
  await handle.focus();
  await page.keyboard.press("Space");
  for (const k of keys) {
    await page.waitForTimeout(150); // dnd-kit's keyboard sensor needs a tick between steps
    await page.keyboard.press(k);
  }
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
}

test("visited stops: disabled handles, mouse drop onto one lands first-unvisited, server order matches", async ({ page }) => {
  const { tripId } = await setup(page, "e2e-rv-mouse");
  const rows = page.getByTestId("stop-row");
  await expect(rows.nth(0).getByTestId("drag-handle")).toBeDisabled();
  await expect(rows.nth(1).getByTestId("drag-handle")).toBeDisabled();
  await expect(rows.nth(2).getByTestId("drag-handle")).toBeEnabled();

  const from = (await rows.nth(4).getByTestId("drag-handle").boundingBox())!;
  const target = (await rows.nth(0).boundingBox())!;
  const persisted = page.waitForResponse((res) => res.request().method() === "PUT" && res.url().includes("/stops/order"));
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 5, from.y - 20, { steps: 5 });
  await page.mouse.move(target.x + 40, target.y + target.height / 2, { steps: 25 });
  await page.mouse.up();
  await persisted;
  await expect.poll(() => order(page)).toEqual(["Alpha", "Bravo", "Echo", "Charlie", "Delta"]);
  expect(await serverOrder(page, tripId)).toEqual(["Alpha", "Bravo", "Echo", "Charlie", "Delta"]);
  await page.reload();
  await expect.poll(() => order(page)).toEqual(["Alpha", "Bravo", "Echo", "Charlie", "Delta"]);
});

test("visited stops: keyboard reorder never passes them and announces the move", async ({ page }) => {
  const { tripId } = await setup(page, "e2e-rv-kbd");
  const persisted = page.waitForResponse((res) => res.request().method() === "PUT" && res.url().includes("/stops/order"));
  await kbd(page, 4, ["ArrowUp", "ArrowUp", "ArrowUp", "ArrowUp"]);
  await persisted;
  await expect.poll(() => order(page)).toEqual(["Alpha", "Bravo", "Echo", "Charlie", "Delta"]);
  await expect(page.getByTestId("announcer")).toHaveText("Moved Echo to position 3 of 5.");
  expect(await serverOrder(page, tripId)).toEqual(["Alpha", "Bravo", "Echo", "Charlie", "Delta"]);

  // A move down within the unvisited stops still works.
  const again = page.waitForResponse((res) => res.request().method() === "PUT" && res.url().includes("/stops/order"));
  await kbd(page, 2, ["ArrowDown"]);
  await again;
  await expect.poll(() => order(page)).toEqual(["Alpha", "Bravo", "Charlie", "Echo", "Delta"]);
  await expect(page.getByTestId("announcer")).toHaveText("Moved Echo to position 4 of 5.");
  await page.reload();
  await expect.poll(() => order(page)).toEqual(["Alpha", "Bravo", "Charlie", "Echo", "Delta"]);
});

test("PUT reorder that moves a visited stop is normalised by the server", async ({ page }) => {
  const { tripId, ids } = await setup(page, "e2e-rv-api");
  const [a, b, c, d, e] = ids;
  const res = await page.request.put(`/api/trips/${tripId}/stops/order`, { data: { stopIds: [e, c, a, d, b] } });
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).stops.map((s: { id: string }) => s.id)).toEqual([a, b, e, c, d]);
  expect(await serverOrder(page, tripId)).toEqual(["Alpha", "Bravo", "Echo", "Charlie", "Delta"]);
});
