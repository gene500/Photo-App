// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage, type MemoryStorage } from "../../../tests/helpers/memory-storage";
import { listTripCopies, saveTripCopy } from "@/lib/offline-store";
import { SETTINGS_KEY } from "@/lib/settings";

vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

let storage: MemoryStorage;
async function setup(email: string | null = "me@example.com") {
  vi.resetModules();
  const { SettingsProvider } = await import("./SettingsProvider");
  const { SettingsView } = await import("./SettingsView");
  render(<SettingsProvider><SettingsView email={email} /></SettingsProvider>);
}
const saved = () => JSON.parse(storage.getItem(SETTINGS_KEY) ?? "{}");

beforeEach(() => {
  storage = installMemoryStorage();
  storage.setItem("rtpp.offline.owner", "u1");
  for (const a of ["data-theme", "data-text-size", "data-reduce-motion"]) document.documentElement.removeAttribute(a);
});

describe("SettingsView", () => {
  it("shows the account email and a sign out button", async () => {
    await setup();
    expect(screen.getByText("me@example.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("segmented controls are labelled radio groups that save immediately", async () => {
    await setup();
    expect(screen.getByRole("radio", { name: "System" })).toHaveProperty("checked", true);
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(saved().theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    await userEvent.click(screen.getByRole("radio", { name: "Large" }));
    expect(document.documentElement.getAttribute("data-text-size")).toBe("large");
    await userEvent.click(screen.getByRole("radio", { name: "Miles" }));
    await userEvent.click(screen.getByRole("radio", { name: "24-hour" }));
    expect(saved()).toMatchObject({ distanceUnit: "mi", timeFormat: "24h" });
    expect(screen.getByRole("group", { name: "Theme" })).toBeTruthy();
  });

  it("reduce motion toggles the attribute", async () => {
    await setup();
    await userEvent.click(screen.getByRole("checkbox", { name: /Reduce motion/ }));
    expect(document.documentElement.getAttribute("data-reduce-motion")).toBe("true");
  });

  it("clamps the default dwell minutes and snaps back on blur", async () => {
    await setup();
    const input = screen.getByLabelText(/Time at each new stop/);
    await userEvent.clear(input);
    expect(saved().defaultDwellMinutes).toBeUndefined();
    await userEvent.type(input, "9999");
    expect(saved().defaultDwellMinutes).toBe(480);
    await userEvent.tab();
    expect((input as HTMLInputElement).value).toBe("480");
  });

  it("clears saved offline copies and confirms", async () => {
    saveTripCopy({ id: "t", name: "T", plannedDate: "2026-07-01", departAt: null, shareToken: null, stops: [] });
    await setup();
    await userEvent.click(screen.getByRole("button", { name: "Clear saved offline copies" }));
    expect(listTripCopies()).toEqual([]);
    expect(screen.getByRole("status").textContent).toMatch(/cleared/);
  });

  it("reset restores the defaults", async () => {
    await setup();
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    await userEvent.click(screen.getByRole("radio", { name: "Extra large" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(screen.getByRole("radio", { name: "System" })).toHaveProperty("checked", true);
    expect(screen.getByRole("radio", { name: "Default" , checked: true })).toBeTruthy();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});

describe("time format labels", () => {
  it("does not claim to follow the device locale (auto is the 12-hour clock)", async () => {
    await setup();
    expect(screen.queryByText("Device default")).toBeNull();
    expect(screen.getByText("Default (12-hour)")).toBeTruthy();
  });
});
