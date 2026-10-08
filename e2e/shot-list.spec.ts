import { expect, test } from "@playwright/test";

test("a stop's shot list persists: add two shots, tick one, reload", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-shots-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Shots");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  await page.getByTestId("map").click({ position: { x: 500, y: 450 } });
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  const rows = page.getByTestId("stop-row");
  await expect(rows).toHaveCount(1);

  await rows.first().getByRole("button").first().click();
  const drawer = page.getByRole("dialog", { name: /^Edit / });
  await drawer.getByLabel("Add a shot").fill("Wide from the rail");
  await drawer.getByLabel("Add a shot").press("Enter");
  await drawer.getByLabel("Add a shot").fill("Detail of the rock");
  await drawer.getByLabel("Add a shot").press("Enter");
  await drawer.getByRole("checkbox", { name: "Wide from the rail" }).check();
  await drawer.getByLabel("Shot notes").fill("Bring the tripod");
  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && /\/api\/stops\/[^/]+$/.test(r.url()));
  await drawer.getByRole("button", { name: "Save" }).click();
  await saved;
  await expect(drawer).toHaveCount(0);

  await page.reload();
  await expect(rows).toHaveCount(1);
  await rows.first().getByRole("button").first().click();
  const again = page.getByRole("dialog", { name: /^Edit / });
  await expect(again.getByRole("checkbox", { name: "Wide from the rail" })).toBeChecked();
  await expect(again.getByRole("checkbox", { name: "Detail of the rock" })).not.toBeChecked();
  await expect(again.getByLabel("Shot notes")).toHaveValue("Bring the tripod");
});
