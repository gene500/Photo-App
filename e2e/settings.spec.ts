import { expect, test, type Page } from "@playwright/test";

async function signup(page: Page, tag: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-settings-${tag}-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
}

const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const LIGHT_BG = "rgb(236, 230, 216)";
const DARK_BG = "rgb(14, 14, 13)";

test("settings: theme, text size, units and reset persist per device", async ({ page }) => {
  await signup(page, "main");
  // Record the <html> attribute the first time the body exists: the inline script must already have run.
  await page.addInitScript(() => {
    const w = window as unknown as { __firstTheme?: string | null; __firstSize?: string | null };
    new MutationObserver(() => {
      if (document.body && w.__firstTheme === undefined) {
        w.__firstTheme = document.documentElement.getAttribute("data-theme");
        w.__firstSize = document.documentElement.getAttribute("data-text-size");
      }
    }).observe(document, { childList: true, subtree: true });
  });

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByText(/Signed in as/)).toContainText("e2e-settings-main-");

  await page.getByRole("radio", { name: "Dark", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("radio", { name: "Large", exact: true }).check();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("18px");
  await page.getByRole("radio", { name: "Extra large" }).check();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("20px");
  await page.getByRole("radio", { name: "Large", exact: true }).check();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-text-size", "large");
  const first = await page.evaluate(() => {
    const w = window as unknown as { __firstTheme?: string | null; __firstSize?: string | null };
    return { __firstTheme: w.__firstTheme, __firstSize: w.__firstSize };
  });
  expect(first.__firstTheme).toBe("dark");
  expect(first.__firstSize).toBe("large");

  // Miles on a real trip.
  await page.getByRole("radio", { name: "Miles", exact: true }).check();
  await page.goto("/trips");
  await page.getByLabel("Trip name").fill("Settings coast");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  for (const x of [500, 800]) {
    await page.getByTestId("map").click({ position: { x, y: 450 } });
    await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
    await page.getByRole("button", { name: "Add stop" }).click();
  }
  await expect(page.getByTestId("route-status")).toContainText(/\d+ mi/);
  await expect(page.getByTestId("route-status")).not.toContainText("km");

  // Reset restores everything.
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  await expect(page.locator("html")).not.toHaveAttribute("data-text-size", /.*/);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("16px");
  await expect(page.getByRole("radio", { name: "Kilometres" })).toBeChecked();
});

test("explicit theme beats the OS colour scheme in both directions", async ({ page }) => {
  await signup(page, "theme");
  await page.goto("/settings");

  await page.emulateMedia({ colorScheme: "dark" });
  expect(await bodyBg(page)).toBe(DARK_BG); // system follows the OS
  await page.getByRole("radio", { name: "Light", exact: true }).check();
  expect(await bodyBg(page)).toBe(LIGHT_BG); // explicit light on a dark OS
  await page.reload();
  expect(await bodyBg(page)).toBe(LIGHT_BG);

  await page.emulateMedia({ colorScheme: "light" });
  expect(await bodyBg(page)).toBe(LIGHT_BG);
  await page.getByRole("radio", { name: "Dark", exact: true }).check();
  expect(await bodyBg(page)).toBe(DARK_BG); // explicit dark on a light OS
  await page.reload();
  expect(await bodyBg(page)).toBe(DARK_BG);
  await page.getByRole("radio", { name: "System", exact: true }).check();
  expect(await bodyBg(page)).toBe(LIGHT_BG);
});

test("settings apply to the public share page without logging in", async ({ page, browser }) => {
  await signup(page, "share");
  await page.getByLabel("Trip name").fill("Shared look");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Create link" }).click();
  const link = await page.getByLabel("Share link").inputValue();

  const ctx = await browser.newContext();
  const anon = await ctx.newPage();
  await anon.addInitScript(() => localStorage.setItem("rtpp.settings.v1", JSON.stringify({ theme: "dark", textSize: "xlarge" })));
  const res = await anon.goto(link);
  expect(res?.headers()["cache-control"]).toContain("no-store");
  expect(res?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(anon.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(anon.locator("html")).toHaveAttribute("data-text-size", "xlarge");
  await ctx.close();
});

test("settings requires a login", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login/);
});
