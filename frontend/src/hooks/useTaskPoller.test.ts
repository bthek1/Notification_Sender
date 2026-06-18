import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as tasksApi from "@/api/tasks";
import { useTaskPoller } from "@/hooks/useTaskPoller";
import type { TaskResult } from "@/types/tasks";

describe("useTaskPoller", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null data and isPolling=false when taskId is null", () => {
    const { result } = renderHook(() => useTaskPoller(null));
    expect(result.current.data).toBeNull();
    expect(result.current.isPolling).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("starts polling when taskId is provided", async () => {
    const pending: TaskResult = {
      task_id: "abc-123",
      status: "PENDING",
      result: null,
      traceback: null,
    };
    vi.spyOn(tasksApi, "fetchTaskStatus").mockResolvedValue(pending);

    const { result } = renderHook(() =>
      useTaskPoller("abc-123", { interval: 200 }),
    );

    await waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });

    expect(result.current.data?.status).toBe("PENDING");
    expect(result.current.isPolling).toBe(true);
  });

  it("stops polling on SUCCESS status", async () => {
    const success: TaskResult = {
      task_id: "abc-123",
      status: "SUCCESS",
      result: { processed: true },
      traceback: null,
    };
    vi.spyOn(tasksApi, "fetchTaskStatus").mockResolvedValue(success);

    const { result } = renderHook(() =>
      useTaskPoller("abc-123", { interval: 200 }),
    );

    await waitFor(() => {
      expect(result.current.isPolling).toBe(false);
    });

    expect(result.current.data?.status).toBe("SUCCESS");
    expect(result.current.data?.result).toEqual({ processed: true });
  });

  it("stops polling on FAILURE status", async () => {
    const failure: TaskResult = {
      task_id: "fail-id",
      status: "FAILURE",
      result: null,
      traceback: "RuntimeError: boom",
    };
    vi.spyOn(tasksApi, "fetchTaskStatus").mockResolvedValue(failure);

    const { result } = renderHook(() =>
      useTaskPoller("fail-id", { interval: 200 }),
    );

    await waitFor(() => {
      expect(result.current.isPolling).toBe(false);
    });

    expect(result.current.data?.status).toBe("FAILURE");
    expect(result.current.data?.traceback).toBe("RuntimeError: boom");
  });

  it("stops polling on REVOKED status", async () => {
    const revoked: TaskResult = {
      task_id: "rev-id",
      status: "REVOKED",
      result: null,
      traceback: null,
    };
    vi.spyOn(tasksApi, "fetchTaskStatus").mockResolvedValue(revoked);

    const { result } = renderHook(() =>
      useTaskPoller("rev-id", { interval: 200 }),
    );

    await waitFor(() => {
      expect(result.current.isPolling).toBe(false);
    });

    expect(result.current.data?.status).toBe("REVOKED");
  });

  it("sets error and stops polling on fetch error", async () => {
    vi.spyOn(tasksApi, "fetchTaskStatus").mockRejectedValue(
      new Error("Network error"),
    );

    const { result } = renderHook(() =>
      useTaskPoller("err-id", { interval: 200 }),
    );

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error?.message).toBe("Network error");
    expect(result.current.isPolling).toBe(false);
  });

  it("polls again after interval elapses while status is non-terminal", async () => {
    const started: TaskResult = {
      task_id: "poll-id",
      status: "STARTED",
      result: null,
      traceback: null,
    };
    const spy = vi
      .spyOn(tasksApi, "fetchTaskStatus")
      .mockResolvedValue(started);

    renderHook(() => useTaskPoller("poll-id", { interval: 100 }));

    // Wait for first call
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    // Wait for at least a second call after the interval
    await waitFor(
      () => expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2),
      {
        timeout: 500,
      },
    );
  });

  it("cleans up interval on unmount", async () => {
    const started: TaskResult = {
      task_id: "cleanup-id",
      status: "STARTED",
      result: null,
      traceback: null,
    };
    const spy = vi
      .spyOn(tasksApi, "fetchTaskStatus")
      .mockResolvedValue(started);

    const { unmount } = renderHook(() =>
      useTaskPoller("cleanup-id", { interval: 100 }),
    );

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    const callCountBeforeUnmount = spy.mock.calls.length;
    unmount();

    // Wait to ensure no further calls after unmount
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });

    expect(spy.mock.calls.length).toBe(callCountBeforeUnmount);
  });
});
