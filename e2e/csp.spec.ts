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

  // The PDF flow (the Export menu), the public share page, and the static-looking pages.
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download PDF" }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Create link" }).click();
  const shareUrl = await page.getByLabel("Share link").inputValue();
  const shared = await page.context().newPage();
  shared.on("console", (m) => {
    if (/content security policy|refused to (load|connect|create|execute|apply)/i.test(m.text())) violations.push(m.text());
  });
  await shared.goto(shareUrl);
  await expect(shared.getByRole("heading", { name: "CSP check" })).toBeVisible();
  const [sharedDownload] = await Promise.all([shared.waitForEvent("download"), shared.getByRole("button", { name: "Download PDF" }).click()]);
  expect(sharedDownload.suggestedFilename()).toMatch(/\.pdf$/);
  for (const path of ["/offline", "/privacy", "/terms", "/settings"]) {
    const res = await shared.goto(path);
    const csp = res!.headers()["content-security-policy"] ?? "";
    expect(csp, path).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp, path).not.toMatch(/script-src[^;]*unsafe-inline/);
    await expect(shared.locator("main, h1").first()).toBeVisible();
  }
  // Every inline script on a page carries the page's nonce (the browser hides the value, so check the attribute exists).
  expect(await shared.evaluate(() => [...document.querySelectorAll("script:not([src])")].filter((s) => (s as HTMLScriptElement).type !== "text/plain" && !(s as HTMLScriptElement).nonce).length)).toBe(0);

  expect(violations).toEqual([]);
});
