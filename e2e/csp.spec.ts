import { expect, test } from "@playwright/test";

// Run against a production build (`E2E_PROD=1 E2E_PORT=3106 npx playwright test e2e/csp.spec.ts`) to check the
// strict policy; under `next dev` it still checks the dev policy.
test("pages carry the security headers and the map + photo popups raise no CSP violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/content security policy|refused to (load|connect|create|execute|apply)/i.test(m.text())) violations.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber} ${e.sample}`);
    });
  });

  const login = await page.goto("/login");
  const h = login!.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBeTruthy();
  expect(h["permissions-policy"]).toContain("geolocation=()");
  expect(h["strict-transport-security"]).toBeTruthy();

  await page.goto("/signup");
  await page.getByLabel("Email").fill(`e2e-csp-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await page.getByLabel("Trip name").fill("CSP check");
  await page.getByLabel("Planned date").fill("2026-07-01");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);

  await page.getByTestId("map").click({ position: { x: 500, y: 200 } });
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  await page.getByTestId("map").click({ position: { x: 700, y: 400 } });
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  await page.getByRole("tab", { name: "Suggestions" }).click();
  await page.getByRole("button", { name: "Find photo spots" }).click();
  await expect(page.getByTestId("suggestion-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Suggestion: Fake Attraction" }).hover();
  await expect(page.getByTestId("suggestion-popup").locator("img")).toBeVisible();
  await page.getByRole("button", { name: "Suggestion: Fake Attraction" }).click();
  await expect(page.getByRole("region", { name: "Selected place" }).locator("img")).toBeVisible();

  expect(violations).toEqual([]);
});
