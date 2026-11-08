// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SESSION_EXPIRED } from "@/lib/session-expired";
import { ErrorBanner } from "./ErrorBanner";

describe("ErrorBanner", () => {
  it("renders nothing without a message", () => {
    const { container } = render(<ErrorBanner message={null} onDismiss={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the message and can be dismissed", async () => {
    const onDismiss = vi.fn();
    render(<ErrorBanner message="Routing failed" onDismiss={onDismiss} />);
    expect(screen.getByRole("alert").textContent).toContain("Routing failed");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("offers a Log in link back to this page when the session has expired", () => {
    render(<ErrorBanner message={SESSION_EXPIRED} onDismiss={() => {}} />);
    expect(screen.getByRole("link", { name: "Log in" }).getAttribute("href")).toBe(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
  });

  it("shows no link for other messages", () => {
    render(<ErrorBanner message="Routing failed" onDismiss={() => {}} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
