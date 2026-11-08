import { expect, test, type Page } from "@playwright/test";
import { newTripViaForm, signUp } from "./helpers";

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function tripWithSunsetStop(page: Page, plannedDate: string) {
  await signUp(page, "e2e-weather");
  await newTripViaForm(page, "Weather check", plannedDate);

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
  // Weather shows on My trip once the route is optimized.
  await page.getByRole("tab", { name: "My trip" }).click();
  await page.getByRole("button", { name: "Optimize route" }).click();
  return page.getByTestId("trip-row");
}

test("every stop on a near date shows a sky icon and temperature", async ({ page }) => {
  const rows = await tripWithSunsetStop(page, inDays(2));
  const temp = /^-?\d+°[CF]$/;
  for (const i of [2, 0]) {
    // Stops that do not care about light (row 0) get weather too.
    const weather = rows.nth(i).getByTestId("stop-weather");
    await expect(weather).toHaveText(temp);
    await expect(weather.locator("svg[data-sky]")).toHaveCount(1);
  }
});

test("a date beyond the forecast horizon shows typical weather, labelled as such", async ({ page }) => {
  const rows = await tripWithSunsetStop(page, inDays(40));
  await expect(rows.nth(2).getByTestId("stop-weather")).toHaveText(/^Typical -?\d+°[CF]$/);
  await expect(rows.nth(2).getByTestId("stop-weather")).toHaveAttribute("title", /^Typically .*rain on ~\d+% of days$/);
});
