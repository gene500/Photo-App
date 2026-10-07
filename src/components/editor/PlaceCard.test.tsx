// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlaceCard } from "./PlaceCard";

describe("PlaceCard", () => {
  it("shows the place name and adds it as a stop", async () => {
    const onAdd = vi.fn();
    render(<PlaceCard name="Tunnel View" resolving={false} busy={false} onAdd={onAdd} onClose={vi.fn()} />);
    expect(screen.getByText("Tunnel View")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add stop" }));
    expect(onAdd).toHaveBeenCalled();
  });

  it("disables adding while the name is still being looked up or a save is in flight", () => {
    const { rerender } = render(<PlaceCard name="Looking up place…" resolving busy={false} onAdd={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Add stop" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<PlaceCard name="Tunnel View" resolving={false} busy onAdd={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Add stop" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("closes", async () => {
    const onClose = vi.fn();
    render(<PlaceCard name="X" resolving={false} busy={false} onAdd={vi.fn()} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
