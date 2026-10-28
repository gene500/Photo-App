import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// The service worker keeps the PDF fonts after the first download, so a later PDF made offline still draws CJK text.
async function tripWith(page: Page, prefix: string, names: string[]) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`${prefix}-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  const res = await page.request.post("/api/trips", { data: { name: "PDF fonts", plannedDate: "2026-07-01" } });
  expect(res.status()).toBe(201);
  const tripId = (await res.json()).trip.id as string;
  for (const [i, name] of names.entries()) {
    const r = await page.request.post(`/api/trips/${tripId}/stops`, { data: { name, lat: 36.5 + i * 0.3, lng: -120.5 + i * 0.4, source: "manual" } });
    expect(r.status()).toBe(201);
  }
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByTestId("stop-row")).toHaveCount(names.length);
}

async function downloadPdf(page: Page) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Download PDF" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("alertdialog", { name: "Itinerary PDF" }).getByRole("button", { name: "Download", exact: true }).click()]);
  const bytes = readFileSync((await download.path())!);
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
  return bytes.toString("latin1");
}


test("PDF fonts are cached by the service worker: a CJK PDF still has CJK text offline", async ({ page, context }) => {
  await tripWith(page, "e2e-fonts-offline", ["北京故宫", "Golden Gate"]);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(async () => !!(await caches.match("/offline"))), { timeout: 20_000 }).toBe(true);
  // Reload so the worker controls the page (a first visit is not controlled).
  await page.reload();
  await expect(page.getByTestId("stop-row")).toHaveCount(2);
  expect(await downloadPdf(page)).toContain("NotoSansCJK");
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).length > 0 && !!(await caches.match("/fonts/NotoSansSC-Regular.ttf")) && !!(await caches.match("/fonts/NotoSans-Regular.ttf"))), { timeout: 15_000 })
    .toBe(true);
  await context.setOffline(true);
  const offlinePdf = await downloadPdf(page);
  expect(offlinePdf).toContain("NotoSansCJK");
  await context.setOffline(false);
});
