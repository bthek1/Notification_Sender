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

export type IntervalPeriod =
  | "days"
  | "hours"
  | "minutes"
  | "seconds"
  | "microseconds";

export interface IntervalSchedule {
  type: "interval";
  every: number;
  period: IntervalPeriod;
}

export interface CrontabSchedule {
  type: "crontab";
  minute: string;
  hour: string;
  day_of_week: string;
  day_of_month: string;
  month_of_year: string;
}

export type PeriodicTaskSchedule = IntervalSchedule | CrontabSchedule;

export interface PeriodicTask {
  id: number;
  name: string;
  task: string;
  enabled: boolean;
  schedule: PeriodicTaskSchedule | null;
  args: string;
  kwargs: string;
  last_run_at: string | null;
  total_run_count: number;
  date_changed: string | null;
}

export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "SUCCESS",
  "FAILURE",
  "REVOKED",
]);
