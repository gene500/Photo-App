// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage, type MemoryStorage } from "../../../tests/helpers/memory-storage";
import { SETTINGS_KEY } from "@/lib/settings";

let storage: MemoryStorage;

// The provider keeps module-level store state, so each test gets a fresh copy.
async function setup() {
  vi.resetModules();
  const mod = await import("./SettingsProvider");
  function Probe() {
    const { settings, update, reset } = mod.useSettings();
    return (
      <div>
        <p data-testid="out">{`${settings.theme}|${settings.textSize}|${settings.distanceUnit}`}</p>
        <button onClick={() => update({ theme: "dark" })}>dark</button>
        <button onClick={() => update({ textSize: "xlarge", distanceUnit: "mi" })}>big</button>
        <button onClick={reset}>reset</button>
      </div>
    );
  }
  render(<mod.SettingsProvider><Probe /></mod.SettingsProvider>);
}

beforeEach(() => {
  storage = installMemoryStorage();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-text-size");
  document.documentElement.removeAttribute("data-reduce-motion");
});

describe("SettingsProvider", () => {
  it("starts from the stored settings and applies them to <html>", async () => {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ theme: "light", textSize: "large" }));
    await setup();
    expect(screen.getByTestId("out").textContent).toBe("light|large|km");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.getAttribute("data-text-size")).toBe("large");
  });

  it("persists changes, applies attributes, and reset restores defaults", async () => {
    await setup();
    await userEvent.click(screen.getByText("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!).theme).toBe("dark");
    await userEvent.click(screen.getByText("big"));
    expect(document.documentElement.getAttribute("data-text-size")).toBe("xlarge");
    expect(screen.getByTestId("out").textContent).toBe("dark|xlarge|mi");
    await userEvent.click(screen.getByText("reset"));
    expect(screen.getByTestId("out").textContent).toBe("system|default|km");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(document.documentElement.hasAttribute("data-text-size")).toBe(false);
  });

  it("recovers from corrupt stored data", async () => {
    storage.setItem(SETTINGS_KEY, "{oops");
    await setup();
    expect(screen.getByTestId("out").textContent).toBe("system|default|km");
  });

  it("follows another tab through the storage event", async () => {
    await setup();
    act(() => {
      storage.setItem(SETTINGS_KEY, JSON.stringify({ theme: "dark", distanceUnit: "mi" }));
      window.dispatchEvent(new StorageEvent("storage", { key: SETTINGS_KEY }));
    });
    expect(screen.getByTestId("out").textContent).toBe("dark|default|mi");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("still works for the visit when storage is blocked", async () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new DOMException("denied", "SecurityError"); },
    });
    await setup();
    expect(screen.getByTestId("out").textContent).toBe("system|default|km");
    await userEvent.click(screen.getByText("dark"));
    expect(screen.getByTestId("out").textContent).toBe("dark|default|km");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("keeps the change in memory when a write fails", async () => {
    storage.failWrites = () => true;
    await setup();
    await userEvent.click(screen.getByText("dark"));
    expect(screen.getByTestId("out").textContent).toBe("dark|default|km");
  });
});
