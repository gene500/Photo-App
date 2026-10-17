import { expect, test } from "@playwright/test";

test("searching a landmark by name finds it with its region and adds it as a stop", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-poi-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Canyon loop");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  await page.getByRole("combobox", { name: "Search for a place" }).fill("Horseshoe Bend");
  const result = page.getByRole("button", { name: /Horseshoe Bend/ }).first();
  await expect(result).toContainText("viewpoint · Page, Arizona");
  await result.click();
  await page.getByRole("button", { name: "Add stop" }).click();
  const rows = page.getByTestId("stop-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Horseshoe Bend, Page, Arizona");
});
