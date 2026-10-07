// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { PlacePhoto } from "@/lib/types";
import { createSuggestionPopupContent } from "./suggestion-popup";

const photo: PlacePhoto = { url: "https://upload.wikimedia.org/a.jpg", title: "Half Dome", pageUrl: "https://en.wikipedia.org/wiki/Half_Dome", credit: "Wikipedia" };
const flush = () => new Promise((r) => setTimeout(r, 0));
const half = { name: "Half Dome", kind: "peak" as const };

describe("createSuggestionPopupContent", () => {
  it("shows a skeleton with the name and capitalised kind while loading", () => {
    const root = createSuggestionPopupContent(half, () => new Promise(() => {}));
    expect(root.querySelector('[data-testid="suggestion-popup-skeleton"]')).not.toBeNull();
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("Half Dome");
    expect(root.textContent).toContain("Peak");
  });

  it("swaps the skeleton for the photo and credits Wikipedia", async () => {
    const root = createSuggestionPopupContent(half, async () => photo);
    await flush();
    const img = root.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(photo.url);
    expect(img.alt).toBe("Half Dome");
    expect(root.querySelector('[data-testid="suggestion-popup-skeleton"]')).toBeNull();
    expect(root.textContent).toContain("Photo: Wikipedia");
  });

  it("shows just name and kind when there is no photo", async () => {
    const root = createSuggestionPopupContent(half, async () => null);
    await flush();
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector('[data-testid="suggestion-popup-skeleton"]')).toBeNull();
    expect(root.textContent).not.toContain("Photo:");
    expect(root.textContent).toContain("Half Dome");
  });

  it("drops the photo (no broken image) when it fails to load or the lookup rejects", async () => {
    const root = createSuggestionPopupContent(half, async () => photo);
    await flush();
    root.querySelector("img")!.dispatchEvent(new Event("error"));
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).not.toContain("Photo:");

    const rejected = createSuggestionPopupContent(half, () => Promise.reject(new Error("x")));
    await flush();
    expect(rejected.querySelector('[data-testid="suggestion-popup-skeleton"]')).toBeNull();
  });

  it("never interprets names as HTML", async () => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    const root = createSuggestionPopupContent({ name: evil, kind: "viewpoint" }, async () => null);
    await flush();
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector('[data-testid="suggestion-popup-name"]')!.textContent).toBe(evil);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("starts the load once", () => {
    const load = vi.fn(async () => null);
    createSuggestionPopupContent(half, load);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
