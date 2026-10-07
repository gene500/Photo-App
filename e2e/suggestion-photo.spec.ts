import { expect, test } from "@playwright/test";

test("hovering a suggestion dot shows its photo popup; the place card shows it on click", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-photo-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("Photo popups");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  // Two stops, then ask for photo spots.
  await page.getByTestId("map").click({ position: { x: 500, y: 200 } });
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  await page.getByTestId("map").click({ position: { x: 700, y: 400 } });
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  await expect(page.getByTestId("stop-row")).toHaveCount(2);
  await page.getByRole("tab", { name: "Suggestions" }).click();
  await page.getByRole("button", { name: "Find photo spots" }).click();
  await expect(page.getByTestId("suggestion-card")).toHaveCount(3);

  // The cards carry the (fake, deterministic) popularity captions.
  const captions = page.getByTestId("suggestion-popularity");
  await expect(captions).toHaveCount(3);
  await expect(page.getByTestId("suggestion-card").filter({ hasText: "Fake Viewpoint" }).getByTestId("suggestion-popularity")).toContainText("≈1.2k photos nearby");
  await expect(page.getByTestId("suggestion-card").filter({ hasText: "Fake Peak" }).getByTestId("suggestion-popularity")).toContainText("≈87 photos nearby");

  // (The offline map is tiny, so the three dots overlap: Fake Attraction is the topmost.)
  // Hover a dot: popup with the name and a photo; gone after the mouse leaves.
  const dot = page.getByRole("button", { name: "Suggestion: Fake Attraction" });
  await dot.hover();
  const popup = page.getByTestId("suggestion-popup");
  await expect(popup.getByTestId("suggestion-popup-name")).toHaveText("Fake Attraction");
  await expect(popup.locator("img")).toBeVisible();
  await expect(popup).toContainText("Photo: Wikipedia");
  await expect(popup.getByTestId("suggestion-popup-popularity")).toHaveText("≈2.5k photos nearby");
  await page.mouse.move(5, 5);
  await expect(popup).toHaveCount(0);

  // Keyboard focus works too.
  await dot.focus();
  await expect(page.getByTestId("suggestion-popup-name")).toHaveText("Fake Attraction");
  await dot.blur();
  await expect(popup).toHaveCount(0);

  // Clicking the dot picks it: the place card carries the photo.
  await dot.click();
  const card = page.getByRole("region", { name: "Selected place" });
  await expect(card).toContainText("Fake Attraction");
  await expect(card.locator("img")).toBeVisible();
  await expect(card.getByTestId("photo-credit")).toHaveText("Photo: Wikipedia");
});
