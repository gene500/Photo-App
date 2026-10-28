import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("searching a landmark by name finds it with its region and adds it as a stop", async ({ page }) => {
  await signUp(page, "e2e-poi");
  await page.getByLabel("Trip name").fill("Canyon loop");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  await page.getByRole("combobox", { name: "Search for a place" }).fill("Horseshoe Bend");
  const result = page.getByRole("option", { name: /Horseshoe Bend/ }).first();
  await expect(result).toContainText("viewpoint · Page, Arizona");
  await result.click();
  await page.getByRole("button", { name: "Add stop" }).click();
  const rows = page.getByTestId("stop-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Horseshoe Bend, Page, Arizona");
});
