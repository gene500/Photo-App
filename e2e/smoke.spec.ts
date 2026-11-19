import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { newTripViaForm, signUp } from "./helpers";

test("core journey: account, trip, stops, optimize, visited, share, GPX, delete", async ({ page, browser }) => {
  // Sign up, sign out, log back in with the same account
  const email = await signUp(page, "e2e-smoke");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  // Retry fill + submit until the login sticks: before hydration React can wipe the form or swallow the click (seen once in CI).
  await expect(async () => {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/trips$/, { timeout: 4000 });
  }).toPass({ timeout: 30000 });

  // Create a trip; add stop 1 through the UI (click the map) and stops 2 and 3 through the API
  await newTripViaForm(page, "Smoke coast");
  const tripId = page.url().split("/").pop()!;
  const rows = page.getByTestId("stop-row");
  await page.getByTestId("map").click({ position: { x: 500, y: 450 } });
  await expect(page.getByText(/^Spot .* \(fake\)$/)).toBeVisible();
  await page.getByRole("button", { name: "Add stop" }).click();
  await expect(rows).toHaveCount(1);
  for (const [i, name] of ["Beta Town", "Gamma Town"].entries()) {
    const r = await page.request.post(`/api/trips/${tripId}/stops`, { data: { name, lat: 36.5 + i * 0.3, lng: -120.5 + i * 0.4, source: "manual" } });
    expect(r.status()).toBe(201);
  }
  await page.reload();
  await expect(rows).toHaveCount(3);

  // Optimize and see the route totals
  await page.getByRole("tab", { name: "My trip" }).click();
  await page.getByRole("button", { name: "Optimize route" }).click();
  await expect(page.getByTestId("route-status")).toHaveText(/\d mi\b/);

  // Tick a stop visited; it persists across a reload
  const tripRows = page.getByTestId("trip-row");
  const visitedSaved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/api/stops/"));
  await tripRows.first().getByLabel("Visited").click();
  await visitedSaved;
  await expect(tripRows.first().getByLabel("Visited")).toBeChecked();
  await page.reload();
  await page.getByRole("tab", { name: "My trip" }).click();
  await expect(tripRows.first().getByLabel("Visited")).toBeChecked();

  // Share link: a fresh logged-out context sees the trip read-only
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Create link" }).click();
  const url = await page.getByLabel("Share link").inputValue();
  expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);
  const stranger = await browser.newContext();
  const shared = await stranger.newPage();
  expect((await shared.goto(url))?.status()).toBe(200);
  await expect(shared.getByRole("heading", { name: "Smoke coast" })).toBeVisible();
  await expect(shared.getByTestId("shared-stop")).toHaveCount(3);
  await expect(shared.getByRole("button", { name: /delete|share|edit/i })).toHaveCount(0);

  // Revoke it: the old URL is a 404
  await page.getByRole("button", { name: "Revoke link" }).click();
  await page.getByRole("button", { name: "Yes, revoke" }).click();
  await expect(page.getByRole("button", { name: "Create link" })).toBeVisible();
  expect((await shared.reload())?.status()).toBe(404);
  await stranger.close();

  // GPX download is XML with the 3 stops
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download GPX" }).click()]);
  const gpx = readFileSync((await download.path())!, "utf8");
  expect(gpx.trimStart()).toMatch(/^<\?xml/);
  expect(gpx).toContain("<gpx");
  expect(gpx.match(/<wpt\b/g)).toHaveLength(3);

  // Delete the trip from the list: empty state
  await page.goto("/trips");
  await page.getByRole("button", { name: "Delete Smoke coast" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("No trips yet. Create one below.")).toBeVisible();
});
