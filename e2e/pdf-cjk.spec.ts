import { expect, test, type Page } from "@playwright/test";
import { downloadPdf, tripWith } from "./helpers";

// The service worker now answers /fonts/ itself, where page.route cannot reach: these tests drive the page's own requests.
test.use({ serviceWorkers: "block" });

// The CJK font file is fetched only when the trip text has Han/kana/Hangul; a Latin-only trip still makes just the two base requests,
// and a blocked CJK request still gives a PDF.
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
