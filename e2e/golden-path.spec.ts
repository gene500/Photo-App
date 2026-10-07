import { expect, test } from "@playwright/test";

test("sign up → create trip → manual stop → accept suggestion → reorder → mark visited", async ({ page }) => {
  // Sign up
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);

  // Create trip
  await page.getByLabel("Trip name").fill("Sierra loop");
  await page.getByLabel("Planned date").fill("2026-07-01");
  for (const [testId, query] of [["place-start", "Alpha Town"], ["place-end", "Beta City"]] as const) {
    const group = page.getByTestId(testId);
    await group.getByRole("textbox").fill(query);
    await group.getByRole("button", { name: "Search" }).click();
    await group.getByRole("button", { name: `${query} (fake)` }).click();
  }
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  await expect(page.getByTestId("route-status")).toHaveText(/km/);

  // Manual stop
  await page.getByTestId("map").click({ position: { x: 120, y: 120 } });
  const rows = page.getByTestId("stop-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Pin 1");

  // Accept a suggestion
  await page.getByRole("button", { name: "Find photo spots" }).click();
  const card = page.getByTestId("suggestion-card").first();
  const suggestionName = (await card.getByTestId("suggestion-name").textContent())!;
  await card.getByRole("button", { name: "Accept" }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText(suggestionName);

  // Reorder: move the suggestion to the top using dnd-kit's keyboard sensor
  const handle = rows.nth(1).getByTestId("drag-handle");
  await handle.focus();
  await page.keyboard.press("Space");
  // dnd-kit's keyboard sensor needs a tick between activation and movement
  // to register the drag start before the next key is processed.
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(150);
  // Wait for the reorder to actually persist (not just the optimistic UI
  // update) before reloading: page.reload() can abort an in-flight fetch
  // that hasn't left the browser yet, which would otherwise make the
  // reload below flaky against a freshly-compiled dev server route.
  const orderPersisted = page.waitForResponse(
    (res) => res.request().method() === "PUT" && res.url().includes("/stops/order"),
  );
  await page.keyboard.press("Space");
  await orderPersisted;
  await expect(rows.first()).toContainText(suggestionName);
  await page.reload();
  await expect(rows.first()).toContainText(suggestionName);

  // Mark visited (persists). The checkbox is controlled by server state (no
  // optimistic update), so it only flips after the PATCH resolves: click
  // rather than check() (which demands an immediate state change) and let
  // the auto-retrying assertion below wait for the real update.
  const visitedPersisted = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && res.url().includes("/api/stops/"),
  );
  await rows.first().getByLabel("Visited").click();
  await visitedPersisted;
  await expect(rows.first().getByLabel("Visited")).toBeChecked();
  await page.reload();
  await expect(rows.first().getByLabel("Visited")).toBeChecked();
});
