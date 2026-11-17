// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn(async () => "u1") }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/components/InAppNavMarker", () => ({ InAppNavMarker: () => null }));
vi.mock("@/components/offline/OfflineOwnerSync", () => ({ OfflineOwnerSync: () => null }));
vi.mock("@/components/SignOutButton", () => ({ SignOutButton: () => null }));
import TripsLayout from "./layout";

describe("trips layout", () => {
  it("starts with a skip link to the main content", async () => {
    render(await TripsLayout({ children: <main id="main-content">page</main> } as never));
    const link = screen.getByRole("link", { name: "Skip to content" });
    expect(link.getAttribute("href")).toBe("#main-content");
    expect(document.querySelector("a")).toBe(link); // first thing in tab order
    expect(document.getElementById("main-content")).toBeTruthy();
  });

  it("lets the page fill whatever height the header leaves (no hard-coded header height), so nothing scrolls at any text size", async () => {
    render(await TripsLayout({ children: <main id="main-content">page</main> } as never));
    const body = document.getElementById("main-content")!.parentElement!;
    expect(body.className).toContain("flex-1");
    expect(body.className).toContain("min-h-0");
    expect(body.className).toContain("flex-col");
    expect(document.querySelector("header")!.className).not.toContain("calc(");
  });

  it("gets a definite viewport height only when the page is the editor (main[data-fill]); otherwise it grows and the page scrolls", async () => {
    render(await TripsLayout({ children: <main id="main-content">page</main> } as never));
    const wrapper = document.querySelector("header")!.parentElement!;
    expect(wrapper.className).toContain("min-h-dvh");
    expect(wrapper.className).toContain("has-[main[data-fill]]:h-dvh");
  });
});
