import { expect, test, type Page } from "@playwright/test";
import { tripWith } from "./helpers";

// Header popovers on phones and short portrait screens sit below the floating search bar and stay inside the window.
const SIZES = [{ width: 390, height: 844 }, { width: 360, height: 640 }, { width: 320, height: 480 }, { width: 768, height: 1024 }];

/** True when the element's centre is what a tap would hit (nothing covers it). */
async function hittable(page: Page, name: string | RegExp) {
  const target = page.getByRole("button", { name });
  await expect(target.first()).toBeVisible();
  return target.first().evaluate((el) => {
    el.scrollIntoView({ block: "nearest" });
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (el === hit || el.contains(hit));
  });
}

for (const size of SIZES) {
  test(`popovers clear the search bar and the window edges at ${size.width}x${size.height}`, async ({ page }) => {
    await tripWith(page, "e2e-pop", ["Alpha", "Beta"]);
    await page.setViewportSize(size);
    await expect(page.getByLabel("Trip panel")).toBeVisible();

    await page.getByRole("button", { name: "Export", exact: true }).click();
    const panel = page.getByRole("group", { name: "Export trip" });
    await expect(panel).toBeVisible();
    const search = (await page.getByRole("combobox").or(page.getByPlaceholder(/search/i)).first().boundingBox())!;
    const box = (await panel.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(search.y + search.height - 1);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(await hittable(page, "Download PDF")).toBe(true);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Share", exact: true }).click();
    const share = (await page.getByRole("group", { name: "Share trip" }).boundingBox())!;
    expect(share.y).toBeGreaterThanOrEqual(search.y + search.height - 1);
    expect(share.x).toBeGreaterThanOrEqual(0);
  });
}
