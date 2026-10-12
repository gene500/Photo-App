import { expect, test } from "@playwright/test";

test("deleting the account needs the password, signs out, and the login stops working", async ({ page }) => {
  const email = `e2e-delete-${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);

  await page.goto("/settings");
  await page.getByRole("button", { name: /^Delete account/ }).click();
  await page.getByLabel("Password").fill("wrong-password-here");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByText("That password is not correct")).toBeVisible();

  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toBeVisible();
});

test("privacy and terms are public", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  await page.getByRole("link", { name: "Terms" }).first().click();
  await expect(page.getByRole("heading", { name: "Terms of Service" })).toBeVisible();
});
