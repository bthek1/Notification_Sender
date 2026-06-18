import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SchedulesTable } from "./SchedulesTable";
import type { PeriodicTask } from "@/types/tasks";

const toggleMutate = vi.fn();
const triggerMutate = vi.fn();

vi.mock("@/hooks/useSchedules", () => ({
  useToggleSchedule: () => ({ mutate: toggleMutate, isPending: false }),
  useTriggerSchedule: () => ({ mutate: triggerMutate, isPending: false }),
}));

function makeTask(overrides: Partial<PeriodicTask> = {}): PeriodicTask {
  return {
    id: 1,
    name: "send-reminders",
    task: "apps.notifications.tasks.send",
    enabled: true,
    schedule: { type: "interval", every: 5, period: "minutes" },
    one_off: false,
    args: "[]",
    kwargs: "{}",
    last_run_at: "2026-06-18T05:24:00Z",
    total_run_count: 3,
    date_changed: "2026-06-18T05:20:00Z",
    ...overrides,
  };
}

describe("SchedulesTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an empty state when there are no schedules", () => {
    render(<SchedulesTable schedules={[]} />);
    expect(screen.getByText(/no scheduled tasks/i)).toBeInTheDocument();
  });

  it("renders a row with the task name and schedule description", () => {
    render(<SchedulesTable schedules={[makeTask()]} />);
    expect(screen.getByText("send-reminders")).toBeInTheDocument();
    expect(screen.getByText("every 5 minutes")).toBeInTheDocument();
    expect(screen.getByText("enabled")).toBeInTheDocument();
  });

  it("renders a clocked one-off task with its fire time and badge", () => {
    render(
      <SchedulesTable
        schedules={[
          makeTask({
            name: "fire-event-123",
            schedule: {
              type: "clocked",
              clocked_time: "2026-06-18T06:00:00Z",
            },
            one_off: true,
          }),
        ]}
      />,
    );
    expect(screen.getByText(/^at /)).toBeInTheDocument();
    expect(screen.getByText("one-off")).toBeInTheDocument();
  });

  it("triggers a task when Run now is clicked", async () => {
    const user = userEvent.setup();
    render(<SchedulesTable schedules={[makeTask({ id: 7 })]} />);

    await user.click(screen.getByRole("button", { name: /run now/i }));
    expect(triggerMutate).toHaveBeenCalledWith(7);
  });

  it("toggles an enabled task off when Disable is clicked", async () => {
    const user = userEvent.setup();
    render(<SchedulesTable schedules={[makeTask({ id: 7, enabled: true })]} />);

    await user.click(screen.getByRole("button", { name: /disable/i }));
    expect(toggleMutate).toHaveBeenCalledWith({ id: 7, enabled: false });
  });
});
