import { expect, test } from "@playwright/test";

// The server renders in UTC (as on Vercel) while this browser is in New York: clock text must not differ on hydration.
test.use({ timezoneId: "America/New_York", locale: "en-US" });

test("trip page hydrates cleanly when the browser's time zone differs from the server's", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && /hydrat/i.test(m.text())) problems.push(`console: ${m.text()}`);
  });

  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-tz-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Time zones");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  const rows = page.getByTestId("stop-row");
  for (const [i, x] of [500, 900].entries()) {
    await page.getByTestId("map").click({ position: { x, y: 450 } });
    await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
    await page.getByRole("button", { name: "Add stop" }).click();
    await expect(rows).toHaveCount(i + 1);
  }

  // Start time, Optimize and the arrival lines live on My trip.
  await page.getByRole("tab", { name: "My trip" }).click();
  const tripRows = page.getByTestId("trip-row");
  await page.getByRole("button", { name: "Optimize route" }).click();

  // Save a start time so the time field and the arrival times have something to show after a full server render.
  const startTime = page.getByLabel("Start time");
  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && /\/api\/trips\/[^/]+$/.test(r.url()));
  await startTime.fill("08:30");
  await startTime.blur();
  await saved; // reloading before the save lands would show the old time
  await expect(startTime).toHaveValue("08:30");
  await expect(tripRows.first().getByTestId("best-time")).toHaveText(/\d{1,2}:\d{2} (AM|PM)/);

  // A fresh server render of the saved trip, hydrated in the New York browser.
  await page.reload();
  await page.getByRole("tab", { name: "My trip" }).click();
  await expect(tripRows).toHaveCount(2);
  await expect(page.getByLabel("Start time")).toHaveValue("08:30");
  await expect(tripRows.first().getByTestId("best-time")).toHaveText(/\d{1,2}:\d{2} (AM|PM)/);

  expect(problems).toEqual([]);
});
