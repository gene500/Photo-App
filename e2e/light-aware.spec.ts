import { expect, test } from "@playwright/test";

test("a sunset stop moves the departure so it is reached in its light, and Undo restores", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-light-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Chase the light");
  await page.getByLabel("Planned date").fill("2026-07-01");
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

  // Make the last stop a sunset stop through its drawer.
  await rows.nth(2).getByRole("button").first().click();
  const drawer = page.getByRole("dialog", { name: /^Edit / });
  await drawer.getByLabel("Best light").selectOption("sunset");
  await drawer.getByRole("button", { name: "Save" }).click();
  await expect(drawer).toHaveCount(0);
  await expect(rows.nth(2).getByTestId("best-time")).toHaveText(/^(Misses sunset by|Sunset window)/);
  await expect(page.getByTestId("depart-note")).toHaveCount(0);

  const departSaved = page.waitForResponse((r) => r.request().method() === "PATCH" && /\/api\/trips\/[^/]+$/.test(r.url()));
  await page.getByRole("button", { name: "Optimize route" }).click();
  await departSaved;
  await expect(page.getByTestId("depart-note")).toHaveText(/^Starts \d{1,2}:\d{2} (AM|PM)$/);
  // The sunset stop is now reached inside its window.
  const sunsetRow = rows.filter({ hasText: "Sunset window" });
  await expect(sunsetRow).toHaveCount(1);
  await expect(sunsetRow.getByTestId("best-time")).toHaveText(/Sunset window .* · arrive /);

  const undone = page.waitForResponse((r) => r.request().method() === "PATCH" && /\/api\/trips\/[^/]+$/.test(r.url()));
  await page.getByRole("button", { name: "Undo" }).click();
  await undone;
  await expect(page.getByTestId("depart-note")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);

  // The departure survives a reload, and can be reset by hand.
  await page.getByRole("button", { name: "Optimize route" }).click();
  await expect(page.getByTestId("depart-note")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("depart-note")).toBeVisible();
  const reset = page.waitForResponse((r) => r.request().method() === "PATCH" && /\/api\/trips\/[^/]+$/.test(r.url()));
  await page.getByRole("button", { name: "Reset to sunrise" }).click();
  await reset;
  await expect(page.getByTestId("depart-note")).toHaveCount(0);
});
