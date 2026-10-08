import { expect, test } from "@playwright/test";

test("find alternatives for a stop and swap one in", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-alt-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Alternatives");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  const rows = page.getByTestId("stop-row");
  for (const [i, x] of [500, 700].entries()) {
    await page.getByTestId("map").click({ position: { x, y: 300 } });
    await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
    await page.getByRole("button", { name: "Add stop" }).click();
    await expect(rows).toHaveCount(i + 1);
  }

  await rows.first().getByRole("button").first().click();
  const drawer = page.getByRole("dialog", { name: /^Edit / });
  await drawer.getByRole("button", { name: "Find alternatives" }).click();
  await expect(drawer.getByTestId("alternative-card")).toHaveCount(3);
  await drawer.getByRole("button", { name: "Swap in Fake Viewpoint" }).click();

  await expect(drawer).toHaveCount(0);
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Fake Viewpoint");
  const note = page.getByTestId("swap-note");
  await expect(note).toContainText("for Fake Viewpoint");

  // The swap is saved, not just shown.
  await page.reload();
  await expect(rows.first()).toContainText("Fake Viewpoint");

  // The undo row is client-only, so a reload retires it.
  await expect(page.getByTestId("swap-note")).toHaveCount(0);
});

test("undoing a swap restores the previous place", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-alt-undo-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Alternatives undo");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  const rows = page.getByTestId("stop-row");
  for (const [i, x] of [500, 700].entries()) {
    await page.getByTestId("map").click({ position: { x, y: 300 } });
    await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
    await page.getByRole("button", { name: "Add stop" }).click();
    await expect(rows).toHaveCount(i + 1);
  }
  await rows.first().getByRole("button").first().click();
  const drawer = page.getByRole("dialog", { name: /^Edit / });
  await drawer.getByRole("button", { name: "Find alternatives" }).click();
  await drawer.getByRole("button", { name: "Swap in Fake Peak" }).click();
  await expect(rows.first()).toContainText("Fake Peak");
  await page.getByRole("button", { name: "Undo swap" }).click();
  await expect(rows.first()).not.toContainText("Fake Peak");
  await expect(rows.first()).toContainText(/Spot .* \(fake\)/);
  await expect(page.getByTestId("swap-note")).toHaveCount(0);
});
