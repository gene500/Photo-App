import { expect, test } from "@playwright/test";

test("a saved trip can be reopened from the trips list, and the header goes back", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-reopen-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Reopen me");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  await page.getByRole("combobox", { name: "Search for a place" }).fill("Alpha Town");
  await page.getByRole("button", { name: "Alpha Town (fake)" }).click();
  await page.getByRole("button", { name: "Add stop" }).click();
  await expect(page.getByTestId("stop-row")).toHaveCount(1);

  await page.getByRole("link", { name: "Road Trip Photo Planner" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  // Click the details side of the row, not the name: the whole row is the link.
  await page.getByText(/1 stops$/).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  await expect(page.getByTestId("stop-row")).toHaveCount(1);
});
