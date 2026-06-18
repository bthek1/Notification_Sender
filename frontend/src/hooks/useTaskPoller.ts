import { useEffect, useRef, useState } from "react";

import { fetchTaskStatus } from "@/api/tasks";
import { TERMINAL_STATUSES } from "@/types/tasks";
import type { TaskResult, TaskStatus } from "@/types/tasks";

export type { TaskResult, TaskStatus };

interface UseTaskPollerOptions {
  /** Polling interval in milliseconds. Default: 2000 */
  interval?: number;
}

interface UseTaskPollerReturn<T> {
  data: TaskResult<T> | null;
  isPolling: boolean;
  error: Error | null;
}

/**
 * Polls GET /api/tasks/<taskId>/ at `interval` ms until a terminal status
 * (SUCCESS, FAILURE, REVOKED) is reached, then stops automatically.
 */
export function useTaskPoller<T = unknown>(
  taskId: string | null,
  { interval = 2000 }: UseTaskPollerOptions = {},
): UseTaskPollerReturn<T> {
  const [data, setData] = useState<TaskResult<T> | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!taskId) return;

    setIsPolling(true);
    setError(null);

    const poll = async () => {
      try {
        const result = await fetchTaskStatus<T>(taskId);
        setData(result);
        if (TERMINAL_STATUSES.has(result.status)) {
          clearInterval(intervalRef.current!);
          intervalRef.current = null;
          setIsPolling(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        setIsPolling(false);
      }
    };

    void poll();
    intervalRef.current = setInterval(() => void poll(), interval);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsPolling(false);
    };
  }, [taskId, interval]);

  return { data, isPolling, error };
}
