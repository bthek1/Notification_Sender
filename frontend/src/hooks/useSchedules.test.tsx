import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import {
  useSchedules,
  useToggleSchedule,
  useTriggerSchedule,
} from "./useSchedules";
import { queryKeys } from "@/api/queryKeys";
import type { PeriodicTask } from "@/types/tasks";

vi.mock("@/api/tasks", () => ({
  listSchedules: vi.fn(),
  toggleSchedule: vi.fn(),
  triggerSchedule: vi.fn(),
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

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return { queryClient, Wrapper };
}

describe("useSchedules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches and returns the schedule list", async () => {
    const { listSchedules } = await import("@/api/tasks");
    vi.mocked(listSchedules).mockResolvedValue([makeTask({ id: 2 })]);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSchedules(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].id).toBe(2);
  });

  it("surfaces errors from the API", async () => {
    const { listSchedules } = await import("@/api/tasks");
    vi.mocked(listSchedules).mockRejectedValue(new Error("boom"));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSchedules(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useToggleSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("toggles a task and invalidates the schedule query", async () => {
    const { toggleSchedule } = await import("@/api/tasks");
    vi.mocked(toggleSchedule).mockResolvedValue({ enabled: false });

    const { queryClient, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useToggleSchedule(), {
      wrapper: Wrapper,
    });
    result.current.mutate({ id: 1, enabled: false });

    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(toggleSchedule).toHaveBeenCalledWith(1, false);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.tasks.schedules,
    });
  });
});

describe("useTriggerSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("triggers a task and invalidates after a short delay", async () => {
    const { triggerSchedule } = await import("@/api/tasks");
    vi.mocked(triggerSchedule).mockResolvedValue({ task_id: "t-1" });

    const { queryClient, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useTriggerSchedule(), {
      wrapper: Wrapper,
    });
    result.current.mutate(1);

    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(triggerSchedule).toHaveBeenCalledWith(1);

    expect(invalidateSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.tasks.schedules,
    });
  });
});
