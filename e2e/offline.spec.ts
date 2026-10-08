import { expect, test } from "@playwright/test";

test("a trip opened online is readable from the saved copy while offline, and sign-out wipes it", async ({ page, context }) => {
  const email = `e2e-offline-${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Offline coast");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  await page.getByTestId("map").click({ position: { x: 500, y: 450 } });
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  await expect(page.getByTestId("stop-row")).toHaveCount(1);
  const stopName = (await page.getByTestId("stop-row").locator("button.truncate").innerText()).replace(/^\d+\.\s*/, "");

  // The copy is saved a moment after the last change.
  await expect
    .poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("rtpp.offline.index") ?? "[]") as { stopCount: number }[])[0]?.stopCount), { timeout: 15_000 })
    .toBe(1);
  expect(await page.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k)).join(""))).not.toContain("shareToken\":\"");

  // The worker needs to control the page and have the /offline shell cached before the network goes away.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(async () => !!(await caches.match("/offline"))), { timeout: 20_000 }).toBe(true);
  // The worker caches only the shell and static assets, never pages or API responses.
  const cachedPaths = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) out.push(new URL(r.url).pathname);
    return out;
  });
  expect(cachedPaths).toContain("/offline");
  expect(cachedPaths.filter((p) => p.startsWith("/api/") || p.startsWith("/trips") || p.startsWith("/s/"))).toEqual([]);

  // Open the shell while online so the worker keeps exactly the assets it renders with, then lose the network.
  // Not asserted: a hard reload of /offline with the network off. In this harness `next dev` needs its HMR
  // websocket to hydrate, and Chromium's offline emulation does not apply to the worker's own fetches, so only
  // the worker's fallback logic (src/lib/service-worker.test.ts) covers that path; the saved copy itself is
  // read from localStorage and needs no network.
  await page.goto("/offline");
  await expect(page.getByRole("button", { name: /Offline coast/ })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: /Offline coast/ }).click();
  await expect(page.getByRole("status")).toContainText("You're offline - showing your saved copy from");
  await expect(page.getByTestId("offline-stop")).toHaveCount(1);
  await expect(page.getByTestId("offline-stop")).toContainText(stopName);
  await context.setOffline(false);

  // Signing out removes the copies from the device.
  await page.goto("/trips");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("rtpp.offline.")))).toEqual([]);
});
