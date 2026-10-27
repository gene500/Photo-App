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
    expect((screen.getByRole("button", { name: "Find photo spots" }) as HTMLButtonElement).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Suggestions need a route first.")).toBeTruthy();
  });

  it("renders cards with accept and dismiss", async () => {
    const onAccept = vi.fn();
    const onDismiss = vi.fn();
    render(<SuggestionsPanel {...base} status="done" suggestions={[s]} onAccept={onAccept} onDismiss={onDismiss} />);
    expect(screen.getByTestId("suggestion-name").textContent).toBe("Tunnel View");
    await userEvent.click(screen.getByRole("button", { name: /^Accept/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Dismiss/ }));
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
    const accept = screen.getByRole("button", { name: /^Accept/ });
    await userEvent.dblClick(accept);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect((accept as HTMLButtonElement).getAttribute("aria-disabled")).toBe("true");
    await act(async () => { finish(); });
    expect((screen.getByRole("button", { name: /^Accept/ }) as HTMLButtonElement).getAttribute("aria-disabled")).toBeNull();
  });
});

describe("hover photo beside the suggestion", () => {
  it("shows a photo card next to a hovered suggestion and removes it on leave", async () => {
    const { container } = render(
      <SuggestionsPanel status="done" suggestions={[{ osmId: "node/1", name: "Hover Point", lat: 1, lng: 2, kind: "viewpoint" }]} error={null} canSearch onFind={() => {}} onAccept={() => {}} onDismiss={() => {}} onDismissError={() => {}} />,
    );
    const card = container.querySelector('[data-testid="suggestion-card"]')!;
    await userEvent.hover(card);
    expect(screen.getByTestId("suggestion-hover-photo")).toBeTruthy();
    await userEvent.unhover(card);
    expect(screen.queryByTestId("suggestion-hover-photo")).toBeNull();
  });

  const one = { osmId: "node/1", name: "Hover Point", lat: 1, lng: 2, kind: "viewpoint" as const };
  const props = { status: "done" as const, error: null, canSearch: true, onFind: () => {}, onAccept: () => {}, onDismiss: () => {}, onDismissError: () => {} };

  it("dismisses the photo with Escape", async () => {
    render(<SuggestionsPanel {...props} suggestions={[one]} />);
    await userEvent.hover(screen.getByTestId("suggestion-card"));
    expect(screen.getByTestId("suggestion-hover-photo")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("suggestion-hover-photo")).toBeNull();
  });

  it("drops the photo when the list is re-ranked", async () => {
    const two = { ...one, osmId: "node/2", name: "Second" };
    const { rerender } = render(<SuggestionsPanel {...props} suggestions={[one, two]} />);
    await userEvent.hover(screen.getAllByTestId("suggestion-card")[0]!);
    expect(screen.getByTestId("suggestion-hover-photo")).toBeTruthy();
    rerender(<SuggestionsPanel {...props} suggestions={[two, one]} />);
    expect(screen.queryByTestId("suggestion-hover-photo")).toBeNull();
  });

  it("keeps the photo off keyboard focus when there is no room beside the row", () => {
    const rect = (left: number, right: number) => ({ left, right, top: 0, bottom: 40, width: right - left, height: 40, x: left, y: 0, toJSON() {} }) as DOMRect;
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    // jsdom has no :focus-visible, so pretend every focus came from the keyboard.
    const realMatches = Element.prototype.matches;
    const matches = vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, sel: string) {
      return sel === ":focus-visible" ? true : realMatches.call(this, sel);
    });
    const prevWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    try {
      render(<SuggestionsPanel {...props} suggestions={[one]} />);
      const accept = screen.getByRole("button", { name: /^Accept/ });
      spy.mockReturnValue(rect(0, 320));
      act(() => accept.focus());
      expect(screen.queryByTestId("suggestion-hover-photo")).toBeNull();
      act(() => accept.blur());
      spy.mockReturnValue(rect(0, 100)); // a wide window leaves plenty of room on the right
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
      act(() => accept.focus());
      expect(screen.getByTestId("suggestion-hover-photo")).toBeTruthy();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: prevWidth });
      spy.mockRestore();
      matches.mockRestore();
    }
  });

  it("announces the temperature in the weather label", () => {
    const weather = new Map([["node/1", { text: "18°C", sky: "Partly cloudy" as const, label: "partly cloudy, 15% rain", quality: null }]]);
    render(<SuggestionsPanel {...props} suggestions={[one]} weather={weather} />);
    expect(screen.getByRole("img", { name: "partly cloudy, 15% rain, 18°C" })).toBeTruthy();
  });

  it("moves focus to the next card's button, else the previous, else Find photo spots, when a card goes", async () => {
    const mk = (n: number): Suggestion => ({ ...s, osmId: `node/${n}`, name: `Spot ${n}` });
    const [a, b, c] = [mk(1), mk(2), mk(3)];
    const { rerender } = render(<SuggestionsPanel {...base} status="done" suggestions={[a, b, c]} />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss Spot 1" }));
    rerender(<SuggestionsPanel {...base} status="done" suggestions={[b, c]} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Dismiss Spot 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss Spot 3" }));
    rerender(<SuggestionsPanel {...base} status="done" suggestions={[b]} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Dismiss Spot 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Accept Spot 2" }));
    rerender(<SuggestionsPanel {...base} status="done" suggestions={[]} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Find photo spots" }));
  });

  it("keeps focus on Find photo spots while it searches", async () => {
    const { rerender } = render(<SuggestionsPanel {...base} status="idle" />);
    const find = screen.getByRole("button", { name: "Find photo spots" });
    await userEvent.click(find);
    rerender(<SuggestionsPanel {...base} status="loading" />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Searching…" }));
  });
});
