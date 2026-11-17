import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/** Creates a fresh account (email `<prefix>-<timestamp>@example.com`), waits for the trips list and returns the email. */
export async function signUp(page: Page, prefix: string) {
  const email = `${prefix}-${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  return email;
}

/** On the trips list: creates a trip through the form and waits for its editor. */
export async function newTripViaForm(page: Page, name: string, plannedDate = "2026-07-01") {
  await page.getByLabel("Trip name").fill(name);
  await page.getByLabel("Planned date").fill(plannedDate);
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
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
  return (await downloadPdfBytes(page)).toString("latin1");
}

/** Same export, returning the raw bytes (for pdftotext). */
export async function downloadPdfBytes(page: Page) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Download PDF" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("alertdialog", { name: "Itinerary PDF" }).getByRole("button", { name: "Download", exact: true }).click()]);
  const bytes = readFileSync((await download.path())!);
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
  return bytes;
}

/**
 * The text of a PDF as poppler's `pdftotext` reads it (UTF-8). Needs poppler-utils (CI installs it; locally `brew install poppler`
 * or `apt install poppler-utils`): when the binary is missing the calling test is skipped with that message instead of failing.
 */
export function pdfToText(bytes: Buffer): string {
  if (spawnSync("pdftotext", ["-v"]).error) test.skip(true, "pdftotext (poppler-utils) is not installed: brew install poppler / apt install poppler-utils");
  const dir = mkdtempSync(join(tmpdir(), "pdf-text-"));
  try {
    writeFileSync(join(dir, "out.pdf"), bytes);
    return execFileSync("pdftotext", ["-enc", "UTF-8", join(dir, "out.pdf"), "-"], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
