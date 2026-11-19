import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// The "add your first stop" hint sits on the map, so it must start to the right of the stops panel (or below it on a phone)
// and never be covered: a smaller desktop window used to hide its first words behind the panel.
for (const { w, h } of [{ w: 1028, h: 700 }, { w: 1280, h: 720 }, { w: 844, h: 390 }, { w: 390, h: 844 }]) {
  test(`empty-map hint is not covered by the stops panel at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await signUp(page, "hint");
    await page.getByLabel("Trip name").fill("Hint");
    await page.getByLabel("Planned date").fill("2026-07-01");
    await page.getByRole("button", { name: "Create trip" }).click();
    await expect(page.getByTestId("empty-hint")).toBeVisible();
    const r = await page.evaluate(() => {
      const hint = document.querySelector('[data-testid="empty-hint"]')!;
      const range = document.createRange();
      range.selectNodeContents(hint);
      const text = range.getBoundingClientRect();
      const panel = document.querySelector("aside")!.getBoundingClientRect();
      return { textLeft: text.left, textRight: text.right, textTop: text.top, textBottom: text.bottom, panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom }, vw: window.innerWidth };
    });
    expect(r.textLeft).toBeGreaterThanOrEqual(0);
    expect(r.textRight).toBeLessThanOrEqual(r.vw);
    const overlaps = r.textLeft < r.panel.right && r.textRight > r.panel.left && r.textTop < r.panel.bottom && r.textBottom > r.panel.top;
    expect(overlaps).toBe(false);
  });
}
