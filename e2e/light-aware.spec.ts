import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("a sunset stop moves the departure so it is reached in its light, and Undo restores", async ({ page }) => {
  // A new trip starts at the time of day it was created; late in the evening the sunset stop is already reached in its
  // light and Optimize rightly leaves the departure alone. Pin the clock to midday so the test does not depend on when it runs.
  await page.clock.install({ time: new Date("2026-10-27T12:00:00Z") });
  await signUp(page, "e2e-light");
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
  // Start time and Optimize live on My trip; the light lines appear there once optimized.
  await page.getByRole("tab", { name: "My trip" }).click();
  const tripRows = page.getByTestId("trip-row");
  await expect(page.getByLabel("Start time")).toHaveValue(/^\d{2}:\d{2}$/); // a new trip starts at the time it was created

  const departSaved = page.waitForResponse((r) => r.request().method() === "PATCH" && /\/api\/trips\/[^/]+$/.test(r.url()));
  await page.getByRole("button", { name: "Optimize route" }).click();
  await departSaved;
  await expect(page.getByLabel("Start time")).toHaveValue(/^\d{2}:\d{2}$/);
  await expect(page.getByRole("button", { name: "Reset to now" })).toBeVisible();
  // The sunset stop is now reached inside its window.
  const sunsetRow = tripRows.filter({ hasText: /Sunset \d/ });
  await expect(sunsetRow).toHaveCount(1);
  await expect(sunsetRow.getByTestId("best-time")).toHaveText(/^Sunset \d.* · arrive /);

  const undone = page.waitForResponse((r) => r.request().method() === "PATCH" && /\/api\/trips\/[^/]+$/.test(r.url()));
  await page.getByRole("button", { name: "Undo" }).click();
  await undone;
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);

  // The departure survives a reload, and can be reset by hand.
  await page.getByRole("button", { name: "Optimize route" }).click();
  await expect(page.getByRole("button", { name: "Reset to now" })).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "My trip" }).click();
  await expect(page.getByRole("button", { name: "Reset to now" })).toBeVisible();
  const reset = page.waitForResponse((r) => r.request().method() === "PATCH" && /\/api\/trips\/[^/]+$/.test(r.url()));
  await page.getByRole("button", { name: "Reset to now" }).click();
  await reset;
  await expect(page.getByRole("button", { name: "Reset to now" })).toHaveCount(0);
});
