import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./helpers";

async function newTrip(page: Page, label: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-zfit-${label}-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Fit me");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
}

test("Zoom to fit: absent with no stops, then counts presses with every stop in view", async ({ page }) => {
  await newTrip(page, "a");
  const fit = page.getByRole("button", { name: "Zoom to fit all stops" });
  await expect(fit).toHaveCount(0);
  let count = 0;
  for (const x of [500, 1000, 700]) {
    await page.getByTestId("map").click({ position: { x, y: 450 } });
    await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
    await page.getByRole("button", { name: "Add stop" }).click();
    await expect(page.getByTestId("stop-row")).toHaveCount(++count);
  }
  await expect(fit).toBeVisible();
  const map = page.getByTestId("map");
  await expect(map).toHaveAttribute("data-fit-count", "0");
  await fit.click();
  await expect(map).toHaveAttribute("data-fit-count", "1");
  await fit.focus();
  await page.keyboard.press("Enter");
  await expect(map).toHaveAttribute("data-fit-count", "2");
  const vp = page.viewportSize()!;
  for (const box of await page.getByRole("button", { name: /^Stop \d+:/ }).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(vp.width);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(vp.height);
  }
  await page.screenshot({ path: process.env.ZFIT_SHOT ?? "test-results/zoom-fit.png" });
});

// The selected-stop card used to run under the control column (phone portrait and short landscape).
for (const [label, width, height] of [["phone portrait", 375, 667], ["short landscape", 667, 375]] as const) {
  test(`Zoom to fit stays reachable while a stop card is open (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await signUp(page, `e2e-zfit-card-${width}`);
    await page.getByLabel("Trip name").fill("Fit me");
    await page.getByLabel("Planned date").fill("2026-07-01");
    await page.getByRole("button", { name: "Create trip" }).click();
    await expect(page).toHaveURL(/\/trips\/[^/]+$/);
    const tripId = page.url().split("/").pop()!;
    for (const [name, lat, lng] of [["Card A", 36.8, -119.8], ["Card B", 37.4, -119.0]] as const) {
      expect((await page.request.post(`/api/trips/${tripId}/stops`, { data: { name, lat, lng, source: "manual" } })).status()).toBe(201);
    }
    await page.reload();
    await expect(page.getByTestId("stop-row")).toHaveCount(2);
    const marker = page.getByTestId("map").getByRole("button", { name: /^Stop 1: Card A/ });
    await marker.focus(); // by keyboard: on a phone the marker can sit under the bottom sheet
    await page.keyboard.press("Enter");
    await expect(page.getByRole("region", { name: "Selected stop" })).toBeVisible();
    const fit = page.getByRole("button", { name: "Zoom to fit all stops" });
    const f = (await fit.boundingBox())!;
    const onTop = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".zoom-fit-ctrl"), [f.x + f.width / 2, f.y + f.height / 2]);
    expect(onTop).toBe(true);
    await fit.click();
    await expect(page.getByTestId("map")).toHaveAttribute("data-fit-count", "1");
  });
}
