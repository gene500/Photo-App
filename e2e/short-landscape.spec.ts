import { expect, test, type Page } from "@playwright/test";

// Phone held sideways (short landscape): popovers on top, whole panel scrolls, bounded drag autoscroll, outside drop cancels.
const SIZES = [{ width: 568, height: 320 }, { width: 667, height: 375 }, { width: 844, height: 390 }];

async function setup(page: Page, stopCount: number) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-land-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Landscape");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  // Add the stops at the full desktop size where the fake map is easy to click, then rotate.
  await page.setViewportSize({ width: 1280, height: 800 });
  const rows = page.getByTestId("stop-row");
  for (let i = 0; i < stopCount; i++) {
    await page.getByTestId("map").click({ position: { x: 500 + i * 60, y: 150 + ((i * 97) % 400) } });
    await page.getByRole("button", { name: "Add stop" }).click();
    await expect(rows).toHaveCount(i + 1);
  }
}

const names = (page: Page) => page.getByTestId("stop-row").getByRole("button", { name: /^\d+\./ }).evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));

/** True when the element's centre is what the browser would hit at that point (nothing covers it). */
async function hittable(page: Page, name: string | RegExp) {
  const target = page.getByRole("button", { name }).or(page.getByRole("link", { name }));
  await expect(target.first()).toBeVisible();
  return target.first().evaluate((el) => {
    el.scrollIntoView({ block: "nearest" });
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (el === hit || el.contains(hit));
  });
}

for (const size of SIZES) {
  test(`short landscape ${size.width}x${size.height}: popovers on top, panel scrolls, no sideways scroll`, async ({ page }) => {
    await setup(page, 6);
    await page.setViewportSize(size);
    await expect(page.getByLabel("Trip panel")).toBeVisible();

    // Export popover: its entries are what a tap would hit, not the search bar behind it.
    await page.getByRole("button", { name: "Export" }).click();
    expect(await hittable(page, "Download GPX")).toBe(true);
    expect(await hittable(page, /Open in Apple Maps/)).toBe(true);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Share" }).click();
    expect(await hittable(page, /Create link/)).toBe(true);
    await page.keyboard.press("Escape");

    // The whole panel scrolls: the list keeps its natural height and the last stop can be reached.
    const panel = page.getByLabel("Trip panel");
    const m = await panel.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, oy: getComputedStyle(el).overflowY }));
    expect(m.oy).toBe("auto");
    const list = page.getByTestId("stop-row");
    const first = await list.first().boundingBox();
    const second = await list.nth(1).boundingBox();
    expect(first!.height).toBeGreaterThan(28);
    expect(second!.y).toBeGreaterThan(first!.y);
    await list.last().scrollIntoViewIfNeeded();
    await expect(list.last()).toBeInViewport();
    await panel.evaluate((el) => { el.scrollTop = 0; });
    await expect(page.getByRole("button", { name: "Export" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("short landscape 568x320: dragging a handle ~110px down moves the row down and autoscroll stays bounded", async ({ page }) => {
  await setup(page, 8);
  await page.setViewportSize({ width: 568, height: 320 });
  const before = await names(page);
  const handle = page.getByTestId("stop-row").first().getByTestId("drag-handle");
  // Put the first row a little below the top of the panel, with its neighbours under it (the usual spot to start a drag).
  await page.getByLabel("Trip panel").evaluate((panel) => { const row = panel.querySelector('[data-testid=stop-row]') as HTMLElement; panel.scrollTop += row.getBoundingClientRect().top - panel.getBoundingClientRect().top - 100; });
  const box = (await handle.boundingBox())!;
  const rowH = (await page.getByTestId("stop-row").first().boundingBox())!.height;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const put = page.waitForResponse((res) => res.request().method() === "PUT" && res.url().includes("/stops/order"));
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 10, { steps: 3 });
  await page.mouse.move(x, y + rowH + 20, { steps: 8 });
  await page.waitForTimeout(1200); // held: a runaway autoscroll would carry the row to the end
  await page.mouse.up();
  await put;
  const after = await names(page);
  const strip = (n: string) => n.replace(/^\d+\.\s*/, "");
  const b = before.map(strip);
  // The dragged row's bottom edge ends at the panel's edge, so how far a 1.2 s hold carries it depends on the row height
  // (fonts differ between machines: one place on a Mac, four on the Linux CI runner). What must hold: the row moved down,
  // the others kept their order, and it did not run away to the end of the list (it did, to the last place, before the fix).
  const moved = after.map(strip).indexOf(b[0]);
  expect(moved).toBeGreaterThan(0);
  expect(moved).toBeLessThanOrEqual(b.length - 3);
  expect(after.map(strip).filter((n) => n !== b[0])).toEqual(b.slice(1));
});

test("a mouse drag released outside the list cancels the reorder: same order, no PUT", async ({ page }) => {
  await setup(page, 3);
  await page.setViewportSize({ width: 1280, height: 800 });
  const before = await names(page);
  let puts = 0;
  page.on("request", (r) => { if (r.method() === "PUT" && r.url().includes("/stops/order")) puts++; });
  const handle = page.getByTestId("stop-row").first().getByTestId("drag-handle");
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 20, y + 20, { steps: 4 });
  await page.mouse.move(900, 400, { steps: 10 }); // over the map, outside the list
  await page.mouse.up();
  await page.waitForTimeout(500);
  expect(puts).toBe(0);
  expect(await names(page)).toEqual(before);
});
