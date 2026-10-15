import { expect, test } from "@playwright/test";

test("change password: wrong current password is refused, then sign in again with the new one", async ({ page }) => {
  const email = `e2e-pw-${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);

  await page.goto("/settings");
  await page.getByRole("button", { name: "Change password…" }).click();
  await page.getByLabel("Current password").fill("not-my-password");
  await page.getByLabel("New password").fill("brand-new-password-1");
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(page.getByText("That password is not correct")).toBeVisible();

  await page.getByLabel("Current password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.waitForLoadState("networkidle"); // fill only after the page has hydrated, or React can reset the fields

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("brand-new-password-1");
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/trips$/);
});
