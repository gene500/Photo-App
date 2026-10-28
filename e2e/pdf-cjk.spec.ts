import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// The service worker now answers /fonts/ itself, where page.route cannot reach: these tests drive the page's own requests.
test.use({ serviceWorkers: "block" });

// The CJK font file is fetched only when the trip text has Han/kana/Hangul; a Latin-only trip still makes just the two base requests,
// and a blocked CJK request still gives a PDF.
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

function watchFonts(page: Page) {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/fonts/NotoSans")) urls.push(new URL(r.url()).pathname);
  });
  return urls;
}

test("a trip with Chinese, Japanese, Korean and Latin stop names downloads a PDF embedding the CJK font (3 font requests)", async ({ page }) => {
  await tripWith(page, "e2e-cjk", ["北京故宫", "ひらがなカタカナ", "서울 한강공원", "Golden Gate"]);
  const fonts = watchFonts(page);
  const pdf = await downloadPdf(page);
  expect(pdf).toContain("NotoSansCJK");
  expect(fonts.sort()).toEqual(["/fonts/NotoSans-Bold.ttf", "/fonts/NotoSans-Regular.ttf", "/fonts/NotoSansSC-Regular.ttf"]);
});

test("a Korean-majority trip loads the Korean font file", async ({ page }) => {
  await tripWith(page, "e2e-kr", ["서울 한강공원", "부산 해운대", "Golden Gate"]);
  const fonts = watchFonts(page);
  const pdf = await downloadPdf(page);
  expect(pdf).toContain("NotoSansCJK");
  expect(fonts).toHaveLength(3);
  expect(fonts).toContain("/fonts/NotoSansKR-Regular.ttf");
});

test("a Latin-only trip makes exactly two font requests", async ({ page }) => {
  await tripWith(page, "e2e-latin", ["Golden Gate", "Café Münster"]);
  const fonts = watchFonts(page);
  const pdf = await downloadPdf(page);
  expect(pdf).toContain("/BaseFont /NotoSans");
  expect(pdf).not.toContain("NotoSansCJK");
  expect(fonts.sort()).toEqual(["/fonts/NotoSans-Bold.ttf", "/fonts/NotoSans-Regular.ttf"]);
});

test("with the CJK font request blocked the PDF still downloads", async ({ page }) => {
  await tripWith(page, "e2e-cjk-blocked", ["北京故宫", "Golden Gate"]);
  await page.route("**/fonts/NotoSansSC-Regular.ttf", (route) => route.abort());
  const pdf = await downloadPdf(page);
  expect(pdf).toContain("/BaseFont /NotoSans");
  expect(pdf).not.toContain("NotoSansCJK");
});
