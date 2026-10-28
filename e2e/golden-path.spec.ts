import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("sign up → new trip → search + click to add stops → suggestion → reorder → mark visited", async ({ page }) => {
  // Sign up
  await signUp(page, "e2e");

  // New trip: just a name and a date, then the empty map
  await page.getByLabel("Trip name").fill("Sierra loop");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  await expect(page.getByTestId("empty-hint")).toBeVisible();
  await page.getByRole("tab", { name: "My trip" }).click();
  await expect(page.getByTestId("route-status")).toHaveText("Add 2 stops to plan the route");
  await page.getByRole("tab", { name: "Stops" }).click();

  // Stop 1: search as you type, pick the result, add it
  await page.getByRole("combobox", { name: "Search for a place" }).fill("Alpha Town");
  await page.getByRole("option", { name: "Alpha Town (fake)" }).click();
  await page.getByRole("button", { name: "Add stop" }).click();
  const rows = page.getByTestId("stop-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Alpha Town (fake)");

  // Stop 2: click the map, wait for the lookup to name it, add it
  await page.getByTestId("map").click({ position: { x: 400, y: 300 } });
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  await expect(rows).toHaveCount(2);

  // No driving line until Optimize
  await expect(page.getByTestId("route-line")).toHaveCount(0);

  // My trip: totals appear only after Optimize
  await page.getByRole("tab", { name: "My trip" }).click();
  await expect(page.getByTestId("route-status")).toHaveText("Optimize the route to see drive times and the route line");
  await page.getByRole("button", { name: "Optimize route" }).click();
  await expect(page.getByTestId("route-status")).toHaveText(/\d mi\b/);
  await expect(page.getByTestId("stop-role")).toHaveText(["Start", "End"]);
  await expect(page.getByTestId("route-line")).toHaveCount(1);

  // Accept a suggestion from the Suggestions tab
  await page.getByRole("tab", { name: "Suggestions" }).click();
  await page.getByRole("button", { name: "Find photo spots" }).click();
  const card = page.getByTestId("suggestion-card").first();
  const suggestionName = (await card.getByTestId("suggestion-name").textContent())!;
  await card.getByRole("button", { name: "Accept" }).click();
  await page.getByRole("tab", { name: "Stops" }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText(suggestionName);

  // Reorder: move the suggestion to the top using dnd-kit's keyboard sensor
  const handle = rows.nth(2).getByTestId("drag-handle");
  await handle.focus();
  await page.keyboard.press("Space");
  // dnd-kit's keyboard sensor needs a tick between activation and movement.
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(150);
  // Wait for the reorder to persist before reloading (reload can abort an in-flight fetch).
  const orderPersisted = page.waitForResponse(
    (res) => res.request().method() === "PUT" && res.url().includes("/stops/order"),
  );
  await page.keyboard.press("Space");
  await orderPersisted;
  await expect(rows.first()).toContainText(suggestionName);
  await page.reload();
  await expect(rows.first()).toContainText(suggestionName);

  // Mark visited (persists). The checkbox is controlled by server state, so click
  // and let the auto-retrying assertion wait for the PATCH to land.
  await page.getByRole("tab", { name: "My trip" }).click();
  const tripRows = page.getByTestId("trip-row");
  const visitedPersisted = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && res.url().includes("/api/stops/"),
  );
  await tripRows.first().getByLabel("Visited").click();
  await visitedPersisted;
  await expect(tripRows.first().getByLabel("Visited")).toBeChecked();
  await page.reload();
  await page.getByRole("tab", { name: "My trip" }).click();
  await expect(tripRows.first().getByLabel("Visited")).toBeChecked();
});
