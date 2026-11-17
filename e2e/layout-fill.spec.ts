import { expect, test } from "@playwright/test";
import { signUp, tripWith } from "./helpers";

// The editor fills exactly the area under the header, so the map is as tall as <main> and the page never scrolls vertically,
// at any viewport and at 200% text (where the header wraps taller).
const sizes = [
  { w: 1280, h: 720 },
  { w: 1280, h: 800 },
  { w: 390, h: 844 },
  { w: 844, h: 390 },
  { w: 320, h: 568 },
];

for (const { w, h } of sizes) {
  for (const big of [false, true]) {
    test(`editor map fills main and the page does not scroll at ${w}x${h}${big ? " with 200% text" : ""}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await tripWith(page, "fill", ["Alpha"]);
      if (big) await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
      const m = await page.evaluate(() => {
        const box = (el: Element | null) => el!.getBoundingClientRect();
        const header = document.querySelector("header")!;
        return {
          map: box(document.querySelector('[data-testid="map"]')).height,
          main: box(document.querySelector("main")).height,
          header: box(header).height,
          scrollHeight: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight,
        };
      });
      expect(m.scrollHeight).toBe(m.innerHeight);
      expect(Math.abs(m.map - m.main)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.main + m.header - m.innerHeight)).toBeLessThanOrEqual(1);
    });
  }
}

test("the trips list still scrolls the page when it is taller than the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await signUp(page, "fill-list");
  for (let i = 0; i < 6; i++) expect((await page.request.post("/api/trips", { data: { name: `Trip ${i}`, plannedDate: "2026-07-01" } })).status()).toBe(201);
  await page.goto("/trips");
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(500);
});
