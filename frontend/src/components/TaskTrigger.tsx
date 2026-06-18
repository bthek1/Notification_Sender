import { useState } from "react";

import { triggerTask } from "@/api/tasks";
import { useTaskPoller } from "@/hooks/useTaskPoller";

/**
 * Demo component: triggers a task and polls its status until completion.
 */
export function TaskTrigger() {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const { data, isPolling, error: pollError } = useTaskPoller(taskId);

  const handleTrigger = async () => {
    setTriggering(true);
    setTriggerError(null);
    try {
      const { task_id } = await triggerTask({ demo: true });
      setTaskId(task_id);
    } catch (err) {
      setTriggerError(
        err instanceof Error ? err.message : "Failed to trigger task",
      );
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="rounded border p-4 space-y-3">
      <h2 className="font-semibold text-lg">Celery Task Demo</h2>

      <button
        onClick={() => void handleTrigger()}
        disabled={triggering || isPolling}
        className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
      >
        {triggering
          ? "Triggering…"
          : isPolling
            ? "Processing…"
            : "Trigger Task"}
      </button>

      {triggerError && <p className="text-red-600 text-sm">{triggerError}</p>}

      {pollError && (
        <p className="text-red-600 text-sm">Poll error: {pollError.message}</p>
      )}

      {data && (
        <div className="text-sm font-mono bg-gray-100 p-3 rounded space-y-1">
          <p>
            <span className="font-bold">Task ID:</span> {data.task_id}
          </p>
          <p>
            <span className="font-bold">Status:</span> {data.status}
          </p>
          {data.result !== null && (
            <p>
              <span className="font-bold">Result:</span>{" "}
              {JSON.stringify(data.result)}
            </p>
          )}
          {data.traceback && (
            <p className="text-red-600">
              <span className="font-bold">Error:</span> {data.traceback}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
