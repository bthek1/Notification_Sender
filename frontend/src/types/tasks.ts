export type TaskStatus =
  | "PENDING"
  | "RECEIVED"
  | "STARTED"
  | "SUCCESS"
  | "FAILURE"
  | "RETRY"
  | "REVOKED";

export interface TaskResult<T = unknown> {
  task_id: string;
  status: TaskStatus;
  result: T | null;
  traceback: string | null;
}

export interface TaskTriggerResponse {
  task_id: string;
}

export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "SUCCESS",
  "FAILURE",
  "REVOKED",
]);
