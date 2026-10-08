import { expect, test, type Page } from "@playwright/test";

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function tripWithSunsetStop(page: Page, plannedDate: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-weather-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Weather check");
  await page.getByLabel("Planned date").fill(plannedDate);
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  const rows = page.getByTestId("stop-row");
  let count = 0;
  for (const x of [500, 900, 700]) {
    await page.getByTestId("map").click({ position: { x, y: 450 } });
    await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
    await page.getByRole("button", { name: "Add stop" }).click();
    await expect(rows).toHaveCount(++count);
  }
  await rows.nth(2).getByRole("button").first().click();
  const drawer = page.getByRole("dialog", { name: /^Edit / });
  await drawer.getByLabel("Best light").selectOption("sunset");
  await drawer.getByRole("button", { name: "Save" }).click();
  await expect(drawer).toHaveCount(0);
  return rows;
}

test("a sunset stop on a near date shows its weather forecast", async ({ page }) => {
  const rows = await tripWithSunsetStop(page, inDays(2));
  await expect(rows.nth(2).getByTestId("stop-weather")).toHaveText(/^((clear|partly cloudy|mostly cloudy|overcast), \d+% rain|rain likely \(\d+%\))$/);
  // Stops that do not care about light show no forecast.
  await expect(rows.nth(0).getByTestId("stop-weather")).toHaveCount(0);
});

test("a date beyond the forecast horizon says the forecast is not available yet", async ({ page }) => {
  const rows = await tripWithSunsetStop(page, inDays(40));
  await expect(rows.nth(2).getByTestId("stop-weather")).toHaveText("Forecast not available yet");
});
