import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

/** Creates a fresh account (email `<prefix>-<timestamp>@example.com`) and waits for the trips list. */
export async function signUp(page: Page, prefix: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`${prefix}-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
}

/** Signs up, creates a trip with one manual stop per name, and opens it. */
export async function tripWith(page: Page, prefix: string, names: string[]) {
  await signUp(page, prefix);
  const res = await page.request.post("/api/trips", { data: { name: "PDF fonts", plannedDate: "2026-07-01" } });
  expect(res.status()).toBe(201);
  const tripId = (await res.json()).trip.id as string;
  for (const [i, name] of names.entries()) {
    const r = await page.request.post(`/api/trips/${tripId}/stops`, { data: { name, lat: 36.5 + i * 0.3, lng: -120.5 + i * 0.4, source: "manual" } });
    expect(r.status()).toBe(201);
  }
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByTestId("stop-row")).toHaveCount(names.length);
}

/** Exports the itinerary PDF through the dialog and returns its bytes as a latin1 string. */
export async function downloadPdf(page: Page) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Download PDF" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("alertdialog", { name: "Itinerary PDF" }).getByRole("button", { name: "Download", exact: true }).click()]);
  const bytes = readFileSync((await download.path())!);
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
  return bytes.toString("latin1");
}
