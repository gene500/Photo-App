import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// The slimmed Stops row keeps its keyboard reordering: Space lifts, arrows move, Space drops.
test("keyboard reorder on the Stops rows: to the top, then one down, and it persists", async ({ page }) => {
  await signUp(page, "e2e-kbd");
  await page.getByLabel("Trip name").fill("Keyboard order");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  const rows = page.getByTestId("stop-row");
  for (const [i, pos] of [{ x: 600, y: 150 }, { x: 800, y: 300 }, { x: 1000, y: 200 }].entries()) {
    await page.getByTestId("map").click({ position: pos });
    await expect(page.getByRole("button", { name: "Add stop" })).toBeVisible();
    await page.getByRole("button", { name: "Add stop" }).click();
    await expect(rows).toHaveCount(i + 1);
  }
  const order = () => rows.getByRole("button", { name: /^\d+\./ }).evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/^\d+\.\s*/, "").trim()));
  const [a, b, c] = await order();
  expect(new Set([a, b, c]).size).toBe(3);

  async function move(from: number, keys: string[]) {
    const persisted = page.waitForResponse((res) => res.request().method() === "PUT" && res.url().includes("/stops/order"));
    await rows.nth(from).getByTestId("drag-handle").focus();
    await page.keyboard.press("Space");
    for (const k of keys) {
      await page.waitForTimeout(150); // dnd-kit's keyboard sensor needs a tick between steps
      await page.keyboard.press(k);
    }
    await page.waitForTimeout(150);
    await page.keyboard.press("Space");
    await persisted;
  }

  await move(2, ["ArrowUp", "ArrowUp"]);
  await expect.poll(order).toEqual([c, a, b]);
  await move(0, ["ArrowDown"]);
  await expect.poll(order).toEqual([a, c, b]);
  await page.reload();
  await expect.poll(order).toEqual([a, c, b]);
});
