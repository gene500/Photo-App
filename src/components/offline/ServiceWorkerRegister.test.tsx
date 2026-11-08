// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceWorkerRegister } from "./ServiceWorkerRegister";

describe("ServiceWorkerRegister", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  });

  it("does not throw when navigator.serviceWorker exists but is undefined", () => {
    vi.stubEnv("NEXT_PUBLIC_SW", "1");
    Object.defineProperty(navigator, "serviceWorker", { value: undefined, configurable: true });
    expect(() => render(<ServiceWorkerRegister />)).not.toThrow();
  });

  it("does not throw when register throws synchronously, and registers when it can", () => {
    vi.stubEnv("NEXT_PUBLIC_SW", "1");
    Object.defineProperty(navigator, "serviceWorker", { value: { register: () => { throw new Error("denied"); } }, configurable: true });
    expect(() => render(<ServiceWorkerRegister />)).not.toThrow();
    const register = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "serviceWorker", { value: { register }, configurable: true });
    render(<ServiceWorkerRegister />);
    expect(register).toHaveBeenCalledWith("/sw.js?dev=1", { scope: "/" });
  });
});
