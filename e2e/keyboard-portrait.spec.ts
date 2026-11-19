import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// QA P3-001: an on-screen keyboard shrinks a portrait phone to something wider than tall (390x340). That used to flip the editor into the
// phone-landscape side panel and squeeze the search box to a sliver. A phone that narrow stays a bottom sheet.
test("a portrait phone with its keyboard open keeps the bottom sheet and a usable search box", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page, "kbd");
  await page.getByLabel("Trip name").fill("Keyboard");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page.getByTestId("empty-hint")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 340 });
  const r = await page.evaluate(() => {
    const aside = document.querySelector("aside")!.getBoundingClientRect();
    return { asideWidth: aside.width, vw: window.innerWidth };
  });
  expect(r.asideWidth).toBeGreaterThan(r.vw * 0.8); // a bottom sheet spans the page; the side panel would be 280px or less
});
