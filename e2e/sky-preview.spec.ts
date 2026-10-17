import { expect, test } from "@playwright/test";

test("selecting a stop draws its sunrise and sunset lines and the drawer shows the sky card", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-sky-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Sky preview");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  const rows = page.getByTestId("stop-row");
  await page.getByTestId("map").click({ position: { x: 700, y: 450 } });
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  await expect(rows).toHaveCount(1);

  // Keyboard, not pointer: a suggestion dot can sit on top of the marker in the fake map.
  await page.getByRole("button", { name: /^Stop 1: / }).press("Enter");
  await expect(page.getByTestId("sky-line-sunrise")).toBeVisible();
  await expect(page.getByTestId("sky-line-sunset")).toBeVisible();

  await rows.first().getByRole("button").first().click();
  const drawer = page.getByRole("dialog", { name: /^Edit / });
  const card = drawer.getByTestId("sky-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Sunrise");
  await expect(card).toContainText("Sunset");
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);

  page.once("dialog", (d) => void d.accept());
  await rows.first().getByRole("button", { name: /^Delete / }).click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByTestId("sky-line-sunrise")).toHaveCount(0);
});

test("opening a stop from the list draws that stop's lines, replacing another stop's", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-sky-list-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Sky from list");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  const rows = page.getByTestId("stop-row");
  await page.getByTestId("map").click({ position: { x: 700, y: 450 } });
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  await expect(rows).toHaveCount(1);

  // No card is open: opening the stop from its list row still draws its lines.
  await expect(page.getByTestId("sky-line-sunrise")).toHaveCount(0);
  await rows.first().getByRole("button").first().click();
  const drawer = page.getByRole("dialog", { name: /^Edit / });
  await expect(drawer).toBeVisible();
  await expect(page.getByTestId("sky-line-sunrise")).toBeVisible();
  await expect(page.getByTestId("sky-line-sunset")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);

  // Stop 1's card is open; opening stop 2 from the list replaces its lines with stop 2's.
  await page.getByTestId("map").click({ position: { x: 900, y: 120 } });
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  await expect(rows).toHaveCount(2);
  await page.getByRole("button", { name: /^Stop 1: / }).press("Enter");
  const sunrise = page.getByTestId("sky-line-sunrise");
  await expect(sunrise).toBeVisible();
  const first = await sunrise.getAttribute("data-bearing");
  await rows.nth(1).getByRole("button").first().click();
  await expect(drawer).toBeVisible();
  await expect(sunrise).not.toHaveAttribute("data-bearing", first ?? "");
});
