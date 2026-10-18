import { readFileSync } from "node:fs";
import { expect, test, type Download, type Page } from "@playwright/test";

const FILENAME = "PDF-coast-itinerary.pdf";

async function signupAndAddStops(page: Page, prefix: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`${prefix}-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("PDF coast");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  const rows = page.getByTestId("stop-row");
  for (const [i, x] of [[1, 500], [2, 800]] as const) {
    await page.getByTestId("map").click({ position: { x, y: 450 } });
    await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
    await page.getByRole("button", { name: "Add stop" }).click();
    await expect(rows).toHaveCount(i);
  }
}

async function expectPdf(download: Download) {
  expect(download.suggestedFilename()).toBe(FILENAME);
  const path = await download.path();
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
  // The Unicode font is embedded, so the text is glyph ids rather than literal strings.
  expect(bytes.toString("latin1")).toContain("/BaseFont /NotoSans");
}

test("editor Export menu downloads the PDF itinerary", async ({ page }) => {
  await signupAndAddStops(page, "e2e-pdf");
  const fontRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/fonts/NotoSans")) fontRequests.push(r.url());
  });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  expect(fontRequests).toEqual([]); // fetched only on click
  await page.getByRole("button", { name: "Download PDF" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("alertdialog", { name: "Itinerary PDF" }).getByRole("button", { name: "Download", exact: true }).click()]);
  await expectPdf(download);
  expect(fontRequests).toHaveLength(2);
});

test("Escape closes only the PDF dialog and focus returns to Export", async ({ page }) => {
  await signupAndAddStops(page, "e2e-pdf-esc");
  const exportBtn = page.getByRole("button", { name: "Export", exact: true });
  await exportBtn.click();
  await page.getByRole("button", { name: "Download PDF" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Itinerary PDF" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(exportBtn).toBeFocused();
  await expect(page.getByRole("group", { name: "Export trip" })).toBeHidden();
});

test("a stranger downloads the PDF from the share page", async ({ page, browser }) => {
  await signupAndAddStops(page, "e2e-pdf-share");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Create link" }).click();
  const url = await page.getByLabel("Share link").inputValue();
  expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);

  const stranger = await browser.newContext({ acceptDownloads: true });
  const shared = await stranger.newPage();
  await shared.goto(url);
  await expect(shared.getByRole("heading", { name: "PDF coast" })).toBeVisible();
  await shared.getByRole("button", { name: "Download PDF" }).click();
  const [download] = await Promise.all([shared.waitForEvent("download"), shared.getByRole("alertdialog", { name: "Itinerary PDF" }).getByRole("button", { name: "Download", exact: true }).click()]);
  await expectPdf(download);
  await stranger.close();
});
