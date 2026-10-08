// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({ api: { createShare: vi.fn(), revokeShare: vi.fn() } }));
import { api } from "@/lib/api-client";
import { ShareControl } from "./ShareControl";

const TOKEN = "t".repeat(43);

describe("ShareControl", () => {
  beforeEach(() => vi.clearAllMocks());

  it("explains the link, then creates it", async () => {
    vi.mocked(api.createShare).mockResolvedValue({ shareToken: TOKEN });
    const onChange = vi.fn();
    render(<ShareControl tripId="t1" shareToken={null} onChange={onChange} />);
    expect(screen.queryByText(/Anyone with the link/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(screen.getByText("Anyone with the link can view this trip (without photos).")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Create link" }));
    expect(api.createShare).toHaveBeenCalledWith("t1");
    expect(onChange).toHaveBeenCalledWith(TOKEN);
  });

  it("shows the link, copies it and revokes it", async () => {
    vi.mocked(api.revokeShare).mockResolvedValue(undefined);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onChange = vi.fn();
    render(<ShareControl tripId="t1" shareToken={TOKEN} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    const url = `${window.location.origin}/s/${TOKEN}`;
    expect((screen.getByLabelText("Share link") as HTMLInputElement).value).toBe(url);
    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(url);
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Revoke link" }));
    expect(api.revokeShare).toHaveBeenCalledWith("t1");
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows an error when creating fails", async () => {
    vi.mocked(api.createShare).mockRejectedValue(new Error("Trip not found"));
    const onChange = vi.fn();
    render(<ShareControl tripId="t1" shareToken={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    await userEvent.click(screen.getByRole("button", { name: "Create link" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Trip not found");
    expect(onChange).not.toHaveBeenCalled();
  });

  describe("popover behaviour", () => {
    it("uses aria-expanded and aria-controls, moves focus in, and Escape returns it to the trigger", async () => {
      render(<ShareControl tripId="t1" shareToken={null} onChange={vi.fn()} />);
      const btn = screen.getByRole("button", { name: "Share" });
      expect(btn.getAttribute("aria-expanded")).toBe("false");
      await userEvent.click(btn);
      expect(btn.getAttribute("aria-expanded")).toBe("true");
      expect(document.getElementById(btn.getAttribute("aria-controls")!)).toBe(screen.getByRole("group", { name: "Share trip" }));
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Create link" }));
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("group", { name: "Share trip" })).toBeNull();
      expect(document.activeElement).toBe(btn);
    });

    it("closes on an outside press but not inside", async () => {
      render(<div><p>outside</p><ShareControl tripId="t1" shareToken={null} onChange={vi.fn()} /></div>);
      await userEvent.click(screen.getByRole("button", { name: "Share" }));
      await userEvent.click(screen.getByText(/Anyone with the link/));
      expect(screen.getByRole("group", { name: "Share trip" })).toBeTruthy();
      await userEvent.click(screen.getByText("outside"));
      expect(screen.queryByRole("group", { name: "Share trip" })).toBeNull();
    });
  });
});
