import { expect, test } from "@playwright/test";

test("dropping the first stop opens suggestions around it automatically", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-first-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("First stop");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  await page.getByTestId("map").click({ position: { x: 500, y: 200 } });
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  await expect(page.getByTestId("stop-row")).toHaveCount(1);

  // No button press: the three nearby spots just appear.
  await page.getByRole("tab", { name: /Suggestions/ }).click();
  await expect(page.getByTestId("suggestion-card")).toHaveCount(3);
});
