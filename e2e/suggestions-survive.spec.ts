import { expect, test } from "@playwright/test";

// A generated suggestions list stays until the owner asks for a new search, whatever is done on the other tabs.
test("suggestions stay after actions on My trip and Stops", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-sugstay-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Suggestions stay");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  const stopRows = page.getByTestId("stop-row");
  let count = 0;
  for (const x of [500, 1000, 700, 850]) {
    await page.getByTestId("map").click({ position: { x, y: 450 } });
    await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
    await page.getByRole("button", { name: "Add stop" }).click();
    await expect(stopRows).toHaveCount(++count);
  }

  const cards = page.getByTestId("suggestion-card");
  const stillThere = async (label: string) => {
    await page.getByRole("tab", { name: /^Suggestions/ }).click();
    await expect(cards, label).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Find photo spots" })).toBeVisible();
    expect(await page.evaluate(() => (document.querySelector("main") as unknown as { __tag?: number }).__tag), `${label}: editor remounted`).toBe(1);
  };
  await page.getByRole("tab", { name: "Suggestions" }).click();
  await page.getByRole("button", { name: "Find photo spots" }).click();
  await expect(cards).toHaveCount(3);
  await page.evaluate(() => { (document.querySelector("main") as unknown as { __tag: number }).__tag = 1; });

  // My trip: Optimize, Undo, visited tick.
  await page.getByRole("tab", { name: "My trip" }).click();
  const order = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/stops/order"));
  await page.getByRole("button", { name: "Optimize route" }).click();
  await order;
  await expect(page.getByTestId("route-status")).toHaveText(/\d mi\b/);
  await stillThere("after Optimize");

  await page.getByRole("tab", { name: "My trip" }).click();
  const undone = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/stops/order"));
  await page.getByRole("button", { name: "Undo" }).click();
  await undone;
  await stillThere("after Undo");

  await page.getByRole("tab", { name: "My trip" }).click();
  const tick = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/api/stops/"));
  await page.getByTestId("trip-row").nth(1).getByLabel("Visited").click();
  await tick;
  await stillThere("after visited tick");

  await page.getByRole("tab", { name: "My trip" }).click();
  const untick = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/api/stops/"));
  await page.getByTestId("trip-row").nth(1).getByLabel("Visited").click();
  await untick;
  await stillThere("after visited untick");

  // Stops: delete one.
  await page.getByRole("tab", { name: "Stops" }).click();
  const del = page.waitForResponse((r) => r.request().method() === "DELETE");
  await stopRows.last().getByRole("button", { name: /^Delete / }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await del;
  await stillThere("after delete");
});

test("suggestions stay after start time and a reorder", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-sugstay2-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Suggestions stay 2");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  const stopRows = page.getByTestId("stop-row");
  let count = 0;
  for (const x of [500, 1000, 700]) {
    await page.getByTestId("map").click({ position: { x, y: 450 } });
    await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
    await page.getByRole("button", { name: "Add stop" }).click();
    await expect(stopRows).toHaveCount(++count);
  }
  const cards = page.getByTestId("suggestion-card");
  const stillThere = async (label: string) => {
    await page.getByRole("tab", { name: /^Suggestions/ }).click();
    await expect(cards, label).toHaveCount(3);
  };
  await page.getByRole("tab", { name: "Suggestions" }).click();
  await page.getByRole("button", { name: "Find photo spots" }).click();
  await expect(cards).toHaveCount(3);

  // Start time on My trip.
  await page.getByRole("tab", { name: "My trip" }).click();
  await page.getByLabel(/start time/i).first().fill("07:30");
  await page.getByLabel(/start time/i).first().blur();
  await page.waitForTimeout(800);
  await stillThere("after start time");

  // Reorder on Stops with the keyboard.
  await page.getByRole("tab", { name: "Stops" }).click();
  const handle = stopRows.nth(2).getByTestId("drag-handle");
  await handle.focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(150);
  const saved = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/stops/order"));
  await page.keyboard.press("Space");
  await saved;
  await stillThere("after reorder");
});

test("a search still running while the owner works on My trip lands in the list", async ({ page }) => {
  await page.route("**/api/suggestions**", async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await page.route("**/api/suggestions/popularity**", async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-sugstay3-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Suggestions stay 3");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  const stopRows = page.getByTestId("stop-row");
  let count = 0;
  for (const x of [500, 1000, 700, 850]) {
    await page.getByTestId("map").click({ position: { x, y: 450 } });
    await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
    await page.getByRole("button", { name: "Add stop" }).click();
    await expect(stopRows).toHaveCount(++count);
  }
  const cards = page.getByTestId("suggestion-card");
  await page.getByRole("tab", { name: "Suggestions" }).click();
  await page.getByRole("button", { name: "Find photo spots" }).click();
  await page.getByRole("tab", { name: "My trip" }).click();
  const order = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/stops/order"));
  await page.getByRole("button", { name: "Optimize route" }).click();
  await order;
  await page.getByTestId("trip-row").nth(1).getByLabel("Visited").click();
  await page.waitForTimeout(1000);
  await page.getByRole("tab", { name: /^Suggestions/ }).click();
  await expect(cards).toHaveCount(3, { timeout: 15000 });
  await page.getByRole("tab", { name: "My trip" }).click();
  await page.waitForTimeout(3000);
  await page.getByRole("tab", { name: /^Suggestions/ }).click();
  await expect(cards).toHaveCount(3);
});

test("a server refresh of the page keeps the suggestions", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-sugstay4-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Suggestions stay 4");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  const stopRows = page.getByTestId("stop-row");
  let count = 0;
  for (const x of [500, 1000]) {
    await page.getByTestId("map").click({ position: { x, y: 450 } });
    await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
    await page.getByRole("button", { name: "Add stop" }).click();
    await expect(stopRows).toHaveCount(++count);
  }
  const cards = page.getByTestId("suggestion-card");
  await page.getByRole("tab", { name: "Suggestions" }).click();
  await page.getByRole("button", { name: "Find photo spots" }).click();
  await expect(cards).toHaveCount(3);
  const refreshed = page.waitForResponse((r) => r.request().headers()["rsc"] === "1");
  await page.evaluate(() => window.dispatchEvent(new Event("rtpp:write-landed")));
  await refreshed;
  await page.waitForTimeout(1000);
  await expect(cards).toHaveCount(3);
});

test("a reload keeps the generated suggestions and does not search again", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-sugstay5-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Suggestions stay 5");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  const stopRows = page.getByTestId("stop-row");
  let count = 0;
  for (const x of [500, 1000]) {
    await page.getByTestId("map").click({ position: { x, y: 450 } });
    await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
    await page.getByRole("button", { name: "Add stop" }).click();
    await expect(stopRows).toHaveCount(++count);
  }
  const cards = page.getByTestId("suggestion-card");
  await page.getByRole("tab", { name: "Suggestions" }).click();
  await page.getByRole("button", { name: "Find photo spots" }).click();
  await expect(cards).toHaveCount(3);
  // Let popularity finish ranking, so what is saved is the final list.
  await page.waitForTimeout(1500);

  const searched: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/suggestions")) searched.push(r.url());
  });
  await page.reload();
  await page.getByRole("tab", { name: /^Suggestions/ }).click();
  await expect(cards).toHaveCount(3);
  await page.waitForTimeout(2000); // past the quiet-search delay
  expect(searched).toEqual([]);

  // Dismiss survives a second reload too.
  await page.getByRole("button", { name: /^Dismiss / }).first().click();
  await expect(cards).toHaveCount(2);
  await page.reload();
  await page.getByRole("tab", { name: /^Suggestions/ }).click();
  await expect(cards).toHaveCount(2);
});
