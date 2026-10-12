// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fromTimeValue, StartTimeControl, toTimeValue } from "./StartTimeControl";

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

describe("StartTimeControl", () => {
  it("saves the chosen time on blur", async () => {
    const onChange = vi.fn();
    render(<StartTimeControl plannedDate="2026-07-01" departAt={null} onChange={onChange} />);
    expect(screen.getByText("Sunrise at the first stop")).toBeTruthy();
    const input = screen.getByLabelText("Start time");
    await userEvent.type(input, "0915");
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(toTimeValue(onChange.mock.calls[0][0])).toBe("09:15");
  });
  it("clears the start time when the field is emptied", async () => {
    const onChange = vi.fn();
    render(<StartTimeControl plannedDate="2026-07-01" departAt={fromTimeValue("2026-07-01", "07:00")} onChange={onChange} />);
    await userEvent.clear(screen.getByLabelText("Start time"));
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
