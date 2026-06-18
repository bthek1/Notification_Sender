import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as tasksApi from "@/api/tasks";
import { TaskTrigger } from "@/components/TaskTrigger";
import type { TaskResult } from "@/types/tasks";

describe("TaskTrigger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the trigger button", () => {
    render(<TaskTrigger />);
    expect(
      screen.getByRole("button", { name: /trigger task/i }),
    ).toBeInTheDocument();
  });

  it("shows 'Triggering…' while POST is in flight", async () => {
    // Never resolves — keeps the button in the triggering state
    vi.spyOn(tasksApi, "triggerTask").mockReturnValue(new Promise(() => {}));

    render(<TaskTrigger />);
    fireEvent.click(screen.getByRole("button", { name: /trigger task/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /triggering/i }),
      ).toBeInTheDocument();
    });
  });

  it("shows task_id and status after successful trigger", async () => {
    vi.spyOn(tasksApi, "triggerTask").mockResolvedValue({
      task_id: "my-task-123",
    });

    const successResult: TaskResult = {
      task_id: "my-task-123",
      status: "SUCCESS",
      result: { processed: true },
      traceback: null,
    };
    vi.spyOn(tasksApi, "fetchTaskStatus").mockResolvedValue(successResult);

    render(<TaskTrigger />);
    fireEvent.click(screen.getByRole("button", { name: /trigger task/i }));

    await waitFor(() => {
      expect(screen.getByText("my-task-123")).toBeInTheDocument();
    });

    expect(screen.getByText("SUCCESS")).toBeInTheDocument();
  });

  it("shows error message when trigger POST fails", async () => {
    vi.spyOn(tasksApi, "triggerTask").mockRejectedValue(
      new Error("Server error"),
    );

    render(<TaskTrigger />);
    fireEvent.click(screen.getByRole("button", { name: /trigger task/i }));

    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeInTheDocument();
    });
  });

  it("shows traceback when task fails", async () => {
    vi.spyOn(tasksApi, "triggerTask").mockResolvedValue({
      task_id: "fail-task",
    });

    const failResult: TaskResult = {
      task_id: "fail-task",
      status: "FAILURE",
      result: null,
      traceback: "RuntimeError: something broke",
    };
    vi.spyOn(tasksApi, "fetchTaskStatus").mockResolvedValue(failResult);

    render(<TaskTrigger />);
    fireEvent.click(screen.getByRole("button", { name: /trigger task/i }));

    await waitFor(() => {
      expect(screen.getByText(/something broke/)).toBeInTheDocument();
    });
  });
});
