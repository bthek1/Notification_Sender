import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  EventsRangePicker,
  makeDefaultRange,
  rangeAround,
  type TimeRange,
} from "@/components/events/EventsRangePicker";

describe("rangeAround / makeDefaultRange", () => {
  it("builds a symmetric span around the given instant", () => {
    const now = 1_000 * 60_000; // arbitrary fixed epoch-ms
    expect(rangeAround(10, now)).toEqual({
      startMs: now - 10 * 60_000,
      endMs: now + 10 * 60_000,
    });
  });

  it("defaults to ±10 minutes", () => {
    const now = 5_000 * 60_000;
    expect(makeDefaultRange(now)).toEqual(rangeAround(10, now));
  });
});

describe("EventsRangePicker", () => {
  // A fixed range so the rendered input values are deterministic. Non-zero
  // seconds confirm the inputs carry second precision (step="1").
  const value: TimeRange = {
    startMs: new Date("2026-06-18T10:00:05").getTime(),
    endMs: new Date("2026-06-18T10:20:30").getTime(),
  };

  it("renders the From and To bounds in local time", () => {
    render(<EventsRangePicker value={value} onChange={vi.fn()} />);

    expect(screen.getByLabelText("From")).toHaveValue("2026-06-18T10:00:05");
    expect(screen.getByLabelText("To")).toHaveValue("2026-06-18T10:20:30");
  });

  it("emits a new start bound without touching the end", () => {
    const onChange = vi.fn();
    render(<EventsRangePicker value={value} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-06-18T09:30:00" },
    });

    expect(onChange).toHaveBeenCalledWith({
      startMs: new Date("2026-06-18T09:30:00").getTime(),
      endMs: value.endMs,
    });
  });

  it("emits a new end bound without touching the start", () => {
    const onChange = vi.fn();
    render(<EventsRangePicker value={value} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-06-18T10:45:00" },
    });

    expect(onChange).toHaveBeenCalledWith({
      startMs: value.startMs,
      endMs: new Date("2026-06-18T10:45:00").getTime(),
    });
  });

  it("a quick preset re-centres a symmetric span on now", async () => {
    const onChange = vi.fn();
    render(<EventsRangePicker value={value} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "±30m" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as TimeRange;
    // Symmetric around now: midpoint ≈ now, full width = 60 min.
    expect(next.endMs - next.startMs).toBe(60 * 60_000);
  });
});
