import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("optimize route reorders stops for the shortest drive and can be undone", async ({ page }) => {
  await signUp(page, "e2e-opt");
  await page.getByLabel("Trip name").fill("Optimize me");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  const stopRows = page.getByTestId("stop-row");
  const rows = page.getByTestId("trip-row");
  const optimize = page.getByRole("button", { name: "Optimize route" });
  const myTrip = page.getByRole("tab", { name: "My trip" });
  await myTrip.click();
  await expect(optimize).toBeDisabled();
  await page.getByRole("tab", { name: "Stops" }).click();

  // Four stops on one horizontal line, deliberately out of order: x = 500, 1000, 700, 850.
  let count = 0;
  for (const x of [500, 1000, 700, 850]) {
    await page.getByTestId("map").click({ position: { x, y: 450 } });
    await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
    await page.getByRole("button", { name: "Add stop" }).click();
    await expect(stopRows).toHaveCount(++count);
    // Two stops are enough to Optimize (nothing to reorder, it just plans the route).
    await myTrip.click();
    if (count === 1) await expect(optimize).toBeDisabled();
    if (count === 2) await expect(optimize).toBeEnabled();
    await page.getByRole("tab", { name: "Stops" }).click();
  }
  await myTrip.click();
  await expect(optimize).toBeEnabled();

  const names = async () => (await rows.allTextContents()).map((t) => /Spot .*? \(fake\)/.exec(t)?.[0] ?? t);
  const original = await names();
  expect(original).toHaveLength(4);

  const saved = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/stops/order"));
  await optimize.click();
  await saved;
  // West to east is the shortest path from the westmost start: original indices 0, 2, 3, 1.
  await expect.poll(names).toEqual([original[0], original[2], original[3], original[1]]);

  const undone = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/stops/order"));
  await page.getByRole("button", { name: "Undo" }).click();
  await undone;
  await expect.poll(names).toEqual(original);
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);

  // Already optimal now? Optimize, then optimizing again reports it to assistive tech.
  await optimize.click();
  await expect.poll(names).toEqual([original[0], original[2], original[3], original[1]]);
  await optimize.click();
  // The result is shown inline to everyone and is the single live region.
  await expect(page.getByTestId("optimize-status")).toHaveText(/Already the fastest order/);
  await expect(page.getByTestId("optimize-status")).not.toHaveClass(/sr-only/);
});
