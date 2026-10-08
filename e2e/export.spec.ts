import { expect, test } from "@playwright/test";

test("export is disabled under 2 stops, then downloads a .gpx and offers map links", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-export-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Export coast");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  const exportBtn = page.getByRole("button", { name: "Export", exact: true });
  await expect(exportBtn).toBeDisabled();

  const rows = page.getByTestId("stop-row");
  for (const [i, x] of [[1, 500], [2, 800]] as const) {
    await page.getByTestId("map").click({ position: { x, y: 450 } });
    await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
    await page.getByRole("button", { name: "Add stop" }).click();
    await expect(rows).toHaveCount(i);
    if (i === 1) await expect(exportBtn).toBeDisabled();
  }

  await expect(exportBtn).toBeEnabled();
  await exportBtn.click();
  await expect(page.getByRole("link", { name: "Open in Google Maps" })).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=/);
  await expect(page.getByRole("link", { name: "Open in Apple Maps" })).toHaveAttribute("href", /^https:\/\/maps\.apple\.com\/\?saddr=/);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download GPX" }).click()]);
  expect(download.suggestedFilename()).toBe("Export-coast.gpx");
});
