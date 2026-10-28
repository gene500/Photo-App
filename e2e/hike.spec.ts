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

test("My trip shows the hike distance only where there is a hike, and the map line follows selection and the toggle", async ({ page }) => {
  await tripWithTwoStops(page);
  await page.getByRole("tab", { name: "My trip" }).click();
  const rows = page.getByTestId("trip-row");
  await expect(rows).toHaveCount(2);

  // Distance only, with the data credit; the far stop shows nothing.
  const hike = rows.nth(0).getByTestId("stop-hike");
  await expect(hike).toContainText(/^Hike \d+\.\d mi one way/);
  await expect(hike).not.toContainText(/min|hour|easy|moderate|hard|elevation/i);
  await expect(rows.nth(0).getByTestId("hike-attribution")).toHaveText("Trail data © OpenStreetMap contributors");
  await expect(rows.nth(1).getByTestId("stop-hike")).toHaveCount(0);

  // The hike is separate from the route and not drawn until the stop is selected or the toggle is on.
  const line = page.getByTestId("hike-line");
  await expect(line).toHaveCount(0);
  await expect(page.getByTestId("route-line")).toHaveCount(0);

  // Toggle on keeps it visible, off clears it.
  const toggle = rows.nth(0).getByRole("button", { name: /^Show hike/ });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(line).toHaveCount(1);
  await expect(line).toHaveAttribute("data-stop-id", /.+/);
  expect(Number(await line.getAttribute("data-points"))).toBeGreaterThanOrEqual(2);
  await toggle.click();
  await expect(line).toHaveCount(0);

  // Selecting the stop shows it; selecting the other stop (no hike) clears it.
  await page.getByRole("button", { name: /^Stop 1:/ }).click();
  await expect(line).toHaveCount(1);
  await page.getByRole("button", { name: /^Stop 2:/ }).click();
  await expect(line).toHaveCount(0);
  // The route layer was never involved.
  await expect(page.getByTestId("route-casing")).toHaveCount(0);
});

test("the hike toggle works from the keyboard", async ({ page }) => {
  await tripWithTwoStops(page);
  await page.getByRole("tab", { name: "My trip" }).click();
  const toggle = page.getByTestId("trip-row").nth(0).getByRole("button", { name: /^Show hike/ });
  await expect(toggle).toBeVisible();
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("hike-line")).toHaveCount(1);
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("hike-line")).toHaveCount(0);
});
