import { expect, test } from "@playwright/test";
import { downloadPdf, downloadPdfBytes, pdfToText, tripWith } from "./helpers";

// The service worker keeps the PDF fonts after the first download, so a later PDF made offline still draws CJK text.
test("PDF fonts are cached by the service worker: a Japanese PDF still has its kanji (綺) offline", async ({ page, context }) => {
  await tripWith(page, "e2e-fonts-offline", ["メモ：とても綺麗", "Golden Gate"]);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(async () => !!(await caches.match("/offline"))), { timeout: 20_000 }).toBe(true);
  // Reload so the worker controls the page (a first visit is not controlled).
  await page.reload();
  await expect(page.getByTestId("stop-row")).toHaveCount(2);
  expect(await downloadPdf(page)).toContain("NotoSansCJK");
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).length > 0 && !!(await caches.match("/fonts/NotoSansJP-Regular.ttf")) && !!(await caches.match("/fonts/NotoSans-Regular.ttf"))), { timeout: 15_000 })
    .toBe(true);
  await context.setOffline(true);
  const bytes = await downloadPdfBytes(page);
  expect(bytes.toString("latin1")).toContain("NotoSansCJK");
  expect(pdfToText(bytes)).toContain("綺麗");
  await context.setOffline(false);
});
