import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, label: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-flow-${label}-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Flow me");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  const myTrip = page.getByRole("tab", { name: "My trip" });
  let count = 0;
  for (const x of [500, 1000, 700, 850]) {
    await page.getByTestId("map").click({ position: { x, y: 450 } });
    await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
    await page.getByRole("button", { name: "Add stop" }).click();
    await expect(page.getByTestId("stop-row")).toHaveCount(++count);
  }
  await myTrip.click();
  return page.getByRole("button", { name: "Optimize route" });
}

test("Optimize runs the water flow along the route once per run, with every stop in view", async ({ page }) => {
  const optimize = await setup(page, "motion");
  const map = page.getByTestId("map");
  await expect(map).not.toHaveAttribute("data-route-flow", /.*/);

  await optimize.click();
  await expect(map).toHaveAttribute("data-route-flow", "running");
  await expect(page.getByTestId("route-flow")).toHaveCount(1);
  // Nothing is blocked while it runs: the markers still take clicks.
  await expect(page.getByTestId("route-flow")).toHaveCSS("pointer-events", "none");
  // Every stop is inside the browser window.
  const vp = page.viewportSize()!;
  const markers = page.getByRole("button", { name: /^Stop \d+:/ });
  await expect(markers).toHaveCount(4);
  for (const box of await markers.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(vp.width);
    expect(box.bottom).toBeLessThanOrEqual(vp.height);
  }
  await expect(map).toHaveAttribute("data-route-flow", "done", { timeout: 8000 });
  await expect(page.getByTestId("route-flow")).toHaveCount(0);

  // Optimizing again re-runs it.
  await optimize.click();
  await expect(map).toHaveAttribute("data-route-flow", "running");
  await expect(map).toHaveAttribute("data-route-flow", "done", { timeout: 8000 });
});

test("with reduced motion Optimize draws no flow", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const optimize = await setup(page, "reduced");
  const map = page.getByTestId("map");
  await optimize.click();
  await expect(map).toHaveAttribute("data-route-flow", "done");
  await expect(page.getByTestId("route-line")).toHaveCount(1);
  await expect(page.getByTestId("route-flow")).toHaveCount(0);
  // It never goes through "running".
  await page.waitForTimeout(500);
  await expect(map).toHaveAttribute("data-route-flow", "done");
});
