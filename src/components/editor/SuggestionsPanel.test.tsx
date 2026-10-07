// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Suggestion } from "@/lib/types";
import { SuggestionsPanel } from "./SuggestionsPanel";

const s: Suggestion = { osmId: "node/1", name: "Tunnel View", lat: 37.7, lng: -119.7, kind: "viewpoint" };
const noop = () => {};
const base = { suggestions: [], error: null, canSearch: true, onFind: noop, onAccept: noop, onDismiss: noop, onDismissError: noop };

describe("SuggestionsPanel", () => {
  it("disables search until a route exists", () => {
    render(<SuggestionsPanel {...base} status="idle" canSearch={false} />);
    expect((screen.getByRole("button", { name: "Find photo spots" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Suggestions need a route first.")).toBeTruthy();
  });

  it("renders cards with accept and dismiss", async () => {
    const onAccept = vi.fn();
    const onDismiss = vi.fn();
    render(<SuggestionsPanel {...base} status="done" suggestions={[s]} onAccept={onAccept} onDismiss={onDismiss} />);
    expect(screen.getByTestId("suggestion-name").textContent).toBe("Tunnel View");
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onAccept).toHaveBeenCalledWith(s);
    expect(onDismiss).toHaveBeenCalledWith("node/1");
  });

  it("shows a muted photo-count caption only when popularity is known and positive", () => {
    const { rerender } = render(<SuggestionsPanel {...base} status="done" suggestions={[{ ...s, popularity: 1234 }]} />);
    expect(screen.getByTestId("suggestion-popularity").textContent).toContain("≈1.2k photos nearby");
    rerender(<SuggestionsPanel {...base} status="done" suggestions={[{ ...s, popularity: 50 }]} />);
    expect(screen.getByTestId("suggestion-popularity").textContent).toContain("50+ photos nearby");
    rerender(<SuggestionsPanel {...base} status="done" suggestions={[{ ...s, popularity: 0 }]} />);
    expect(screen.queryByTestId("suggestion-popularity")).toBeNull();
    rerender(<SuggestionsPanel {...base} status="done" suggestions={[s]} />);
    expect(screen.queryByTestId("suggestion-popularity")).toBeNull();
  });

  it("does not highlight for touch pointers", () => {
    const onHover = vi.fn();
    render(<SuggestionsPanel {...base} status="done" suggestions={[s]} onHover={onHover} />);
    fireEvent.pointerEnter(screen.getByTestId("suggestion-card"), { pointerType: "touch" });
    expect(onHover).not.toHaveBeenCalledWith("node/1");
  });

  it("shows an empty result message", () => {
    render(<SuggestionsPanel {...base} status="done" />);
    expect(screen.getByText("No more suggestions along this route.")).toBeTruthy();
  });

  it("shows the error with a retry", async () => {
    const onFind = vi.fn();
    render(<SuggestionsPanel {...base} status="error" error="Couldn't load suggestions. Please retry." onFind={onFind} />);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load suggestions");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onFind).toHaveBeenCalled();
  });

  it("reports hover over a suggestion card", async () => {
    const onHover = vi.fn();
    render(<SuggestionsPanel {...base} status="done" suggestions={[s]} onHover={onHover} />);
    await userEvent.hover(screen.getByTestId("suggestion-card"));
    expect(onHover).toHaveBeenLastCalledWith("node/1");
    await userEvent.unhover(screen.getByTestId("suggestion-card"));
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it("ignores a second Accept click while the first is in flight, then re-enables", async () => {
    let finish!: () => void;
    const onAccept = vi.fn(() => new Promise<void>((r) => { finish = r; }));
    render(<SuggestionsPanel {...base} status="done" suggestions={[s]} onAccept={onAccept} />);
    const accept = screen.getByRole("button", { name: "Accept" });
    await userEvent.dblClick(accept);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect((accept as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish(); });
    expect((screen.getByRole("button", { name: "Accept" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
