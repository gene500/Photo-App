import { expect, test, type Page } from "@playwright/test";

// Fake externals: a hike exists only near the middle of the fake map (37, -119.5); everywhere else has none.
async function tripWithTwoStops(page: Page) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-hike-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Hike check");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  const rows = page.getByTestId("stop-row");
  // First the stop at the fake hike point (the middle of the map), then one far away.
  await page.getByTestId("map").click();
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  await expect(rows).toHaveCount(1);
  await page.getByTestId("map").click({ position: { x: 900, y: 120 } });
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  await expect(rows).toHaveCount(2);
}

test("My trip shows the hike distance only where there is a hike, and the map lines follow the Show hikes setting and selection", async ({ page }) => {
  await tripWithTwoStops(page);
  await page.getByRole("tab", { name: "My trip" }).click();
  const rows = page.getByTestId("trip-row");
  await expect(rows).toHaveCount(2);

  // Distance only, no per-card data credit (the map's attribution has it); the far stop shows nothing. No per-stop toggle any more.
  const hike = rows.nth(0).getByTestId("stop-hike");
  await expect(hike).toContainText(/^Hike \d+\.\d mi one way/);
  await expect(hike).not.toContainText(/min|hour|easy|moderate|hard|elevation/i);
  await expect(rows.nth(0).getByText(/Trail data/)).toHaveCount(0);
  await expect(rows.nth(1).getByTestId("stop-hike")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Show hike/ })).toHaveCount(0);

  // Default is on: the stop's hike is drawn, separate from the route.
  const line = page.getByTestId("hike-line");
  await expect(line).toHaveCount(1);
  await expect(line).toHaveAttribute("data-stop-id", /.+/);
  expect(Number(await line.getAttribute("data-points"))).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("route-line")).toHaveCount(0);
  await expect(page.getByTestId("route-casing")).toHaveCount(0);

  // Turn the setting off (it is per device): no lines, but the distance text stays.
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const box = page.getByRole("checkbox", { name: /Show hikes/ });
  await expect(box).toBeChecked();
  await box.focus();
  await page.keyboard.press("Space");
  await expect(box).not.toBeChecked();
  await page.goBack();
  await page.getByRole("tab", { name: "My trip" }).click();
  await expect(page.getByTestId("trip-row").nth(0).getByTestId("stop-hike")).toBeVisible();
  await expect(line).toHaveCount(0);

  // A selected stop's hike still shows; selecting the other stop (no hike) clears it.
  await page.getByRole("button", { name: /^Stop 1:/ }).click();
  await expect(line).toHaveCount(1);
  await page.getByRole("button", { name: /^Stop 2:/ }).click();
  await expect(line).toHaveCount(0);

  // Reset to defaults turns it back on.
  await page.goto("/settings");
  await expect(page.getByRole("checkbox", { name: /Show hikes/ })).not.toBeChecked();
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(page.getByRole("checkbox", { name: /Show hikes/ })).toBeChecked();
});
