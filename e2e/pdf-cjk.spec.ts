import { expect, test, type Page } from "@playwright/test";
import { downloadPdf, downloadPdfBytes, pdfToText, tripWith } from "./helpers";

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

test("a trip with Chinese, Japanese (kana), Korean and Latin stop names keeps the Chinese hanzi: the Japanese file lacks 宫, so the Chinese file wins by coverage", async ({ page }) => {
  await tripWith(page, "e2e-cjk", ["北京故宫", "ひらがなカタカナ", "서울 한강공원", "Golden Gate"]);
  const fonts = watchFonts(page);
  const bytes = await downloadPdfBytes(page);
  expect(bytes.toString("latin1")).toContain("NotoSansCJK");
  expect(fonts.sort()).toEqual(["/fonts/NotoSans-Bold.ttf", "/fonts/NotoSans-Regular.ttf", "/fonts/NotoSansJP-Regular.ttf", "/fonts/NotoSansSC-Regular.ttf"]);
  const text = pdfToText(bytes);
  expect(text).toContain("北京故宫");
  expect(text).toContain("ひらがなカタカナ");
});

test("a Chinese-only trip loads the Chinese font file", async ({ page }) => {
  await tripWith(page, "e2e-sc", ["北京故宫", "上海外滩", "Golden Gate"]);
  const fonts = watchFonts(page);
  expect(await downloadPdf(page)).toContain("NotoSansCJK");
  expect(fonts.sort()).toEqual(["/fonts/NotoSans-Bold.ttf", "/fonts/NotoSans-Regular.ttf", "/fonts/NotoSansSC-Regular.ttf"]);
});

test("a Japanese note with the JIS level 2 kanji 綺 prints it in the PDF text instead of ?", async ({ page }) => {
  await tripWith(page, "e2e-jp", ["メモ：とても綺麗", "Golden Gate"]);
  const fonts = watchFonts(page);
  const text = pdfToText(await downloadPdfBytes(page));
  expect(fonts).toContain("/fonts/NotoSansJP-Regular.ttf");
  expect(text).toContain("綺麗");
  expect(text).not.toMatch(/メモ：とても\?/);
});

test("kana text mixed with Latin Extended stops (Kraków, Łazienki) uses the Japanese font and keeps both", async ({ page }) => {
  await tripWith(page, "e2e-jp-latin", ["東京タワー綺麗", "Kraków Łazienki"]);
  const fonts = watchFonts(page);
  const text = pdfToText(await downloadPdfBytes(page));
  expect(fonts).toContain("/fonts/NotoSansJP-Regular.ttf");
  expect(text).toContain("綺麗");
  expect(text).toContain("Kraków Łazienki");
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
