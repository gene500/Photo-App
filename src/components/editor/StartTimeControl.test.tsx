// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { solarDateAt } from "@/lib/best-time";
import { fromTimeValue, StartTimeControl, toTimeValue } from "./StartTimeControl";

// The helpers read the viewer's zone; pin one so the suite gives the same answer on any machine (CI is UTC).
process.env.TZ = "America/New_York";

describe("start time helpers", () => {
  it("round-trips a time on the trip's day in the viewer's time zone", () => {
    const iso = fromTimeValue("2026-07-01", "08:30");
    expect(iso).not.toBeNull();
    expect(toTimeValue(iso)).toBe("08:30");
    expect(new Date(iso!).getDate()).toBe(1);
  });
  it("rejects malformed input", () => {
    expect(fromTimeValue("2026-07-01", "")).toBeNull();
    expect(fromTimeValue("nope", "08:30")).toBeNull();
    expect(toTimeValue(null)).toBe("");
  });
});

describe("start time lands on the trip's solar day wherever the viewer is", () => {
  it("picks the viewer-local instant whose solar day at the stop is the planned day", () => {
    // New York stop (lng -74): every candidate must map to the planned day at that longitude, whatever the machine's zone.
    for (const time of ["00:30", "07:00", "12:00", "23:30"]) {
      const iso = fromTimeValue("2026-07-01", time, -74)!;
      expect(solarDateAt(new Date(iso), -74)).toBe("2026-07-01");
    }
  });
});

describe("StartTimeControl", () => {
  it("saves the chosen time on blur", async () => {
    const onChange = vi.fn();
    render(<StartTimeControl plannedDate="2026-07-01" departAt={null} onChange={onChange} />);
    expect(screen.getByText("Now")).toBeTruthy();
    const input = screen.getByLabelText("Start time");
    await userEvent.type(input, "0915");
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(toTimeValue(onChange.mock.calls[0][0])).toBe("09:15");
  });
  it("does not clear the start time when the field is emptied; it falls back to the saved time", async () => {
    const onChange = vi.fn();
    const departAt = fromTimeValue("2026-07-01", "07:00");
    render(<StartTimeControl plannedDate="2026-07-01" departAt={departAt} onChange={onChange} />);
    await userEvent.clear(screen.getByLabelText("Start time"));
    await userEvent.tab();
    expect(onChange).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("07:00");
  });
  it("is disabled while an optimize is running", () => {
    render(<StartTimeControl plannedDate="2026-07-01" departAt={null} disabled onChange={() => {}} />);
    expect((screen.getByLabelText("Start time") as HTMLInputElement).disabled).toBe(true);
  });
  it("saves once when Enter is followed by the blur", async () => {
    const onChange = vi.fn();
    render(<StartTimeControl plannedDate="2026-07-01" departAt={null} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Start time"), "0915{Enter}");
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
  it("keeps an edit made while a save is in flight", async () => {
    let finish: () => void = () => {};
    const onChange = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<StartTimeControl plannedDate="2026-07-01" departAt={null} onChange={onChange} />);
    const input = screen.getByLabelText("Start time") as HTMLInputElement;
    await userEvent.type(input, "0915{Enter}"); // save starts and is still pending
    await userEvent.clear(input);
    await userEvent.type(input, "1030");
    await userEvent.tab(); // blurs while saving: not a second save
    expect(onChange).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(input.value).toBe("10:30"); // the newer edit was not thrown away
  });
  it("shows an empty field until mounted (server render)", async () => {
    const { renderToString } = await import("react-dom/server");
    const departAt = fromTimeValue("2026-07-01", "07:00");
    expect(renderToString(<StartTimeControl plannedDate="2026-07-01" departAt={departAt} onChange={() => {}} />)).not.toContain('value="07:00"');
  });
});

describe("StartTimeControl reset", () => {
  it("shows Reset to now beside the input only while a start time is set, disabled while busy", async () => {
    const onReset = vi.fn();
    const { rerender } = render(<StartTimeControl plannedDate="2026-07-01" departAt={null} onChange={vi.fn()} onReset={onReset} />);
    expect(screen.queryByRole("button", { name: "Reset to now" })).toBeNull();
    const iso = fromTimeValue("2026-07-01", "08:30")!;
    rerender(<StartTimeControl plannedDate="2026-07-01" departAt={iso} onChange={vi.fn()} onReset={onReset} />);
    await userEvent.click(screen.getByRole("button", { name: "Reset to now" }));
    expect(onReset).toHaveBeenCalledTimes(1);
    rerender(<StartTimeControl plannedDate="2026-07-01" departAt={iso} disabled onChange={vi.fn()} onReset={onReset} />);
    expect((screen.getByRole("button", { name: "Reset to now" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
