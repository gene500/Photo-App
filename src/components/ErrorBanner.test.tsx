// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
});
