import { expect, test } from "@playwright/test";

test("share a trip read-only, open it logged out, revoke it", async ({ page, browser }) => {
  const email = `e2e-share-${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Shared coast");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  const rows = page.getByTestId("stop-row");
  for (const [i, x] of [[1, 500], [2, 800]] as const) {
    await page.getByTestId("map").click({ position: { x, y: 450 } });
    await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
    await page.getByRole("button", { name: "Add stop" }).click();
    await expect(rows).toHaveCount(i);
  }
  const names = await rows.locator("button.truncate").allInnerTexts();
  expect(names).toHaveLength(2);

  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByText("Anyone with the link can view this trip (without photos).")).toBeVisible();
  await page.getByRole("button", { name: "Create link" }).click();
  const url = await page.getByLabel("Share link").inputValue();
  expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);

  // A fresh context has no cookies: it is a stranger with the link.
  const stranger = await browser.newContext();
  const shared = await stranger.newPage();
  const res = await shared.goto(url);
  expect(res?.status()).toBe(200);
  await expect(shared.getByRole("heading", { name: "Shared coast" })).toBeVisible();
  await expect(shared.getByTestId("shared-stop")).toHaveCount(2);
  for (const n of names) await expect(shared.getByTestId("shared-stop").filter({ hasText: n.replace(/^\d+\.\s*/, "") }).first()).toBeVisible();
  await expect(shared.getByRole("button", { name: /delete|share|edit/i })).toHaveCount(0);
  const html = await shared.content();
  expect(html).not.toContain(email);
  expect(html).toContain('content="noindex, nofollow"');
  expect(html).toContain('name="referrer" content="no-referrer"');

  // The raw server response carries nothing private either.
  const raw = await (await stranger.request.get(url)).text();
  expect(raw).not.toContain(email);
  expect(raw).not.toContain("photoUrl");

  await page.getByRole("button", { name: "Revoke link" }).click();
  await expect(page.getByRole("button", { name: "Create link" })).toBeVisible();
  expect((await shared.reload())?.status()).toBe(404);
  await stranger.close();
});
