import type { PeriodicTaskSchedule } from "@/types/tasks";

/**
 * Render a periodic task schedule as a short human-readable string.
 * Interval schedules become "every 5 minutes"; crontab schedules become a
 * compact "m h dom mon dow" cron expression.
 */
export function describeSchedule(
  schedule: PeriodicTaskSchedule | null,
): string {
  if (!schedule) return "—";

  if (schedule.type === "interval") {
    const { every, period } = schedule;
    // Drop the trailing "s" for a count of 1 (e.g. "every 1 minute").
    const unit = every === 1 ? period.replace(/s$/, "") : period;
    return `every ${every} ${unit}`;
  }

  const { minute, hour, day_of_month, month_of_year, day_of_week } = schedule;
  return `${minute} ${hour} ${day_of_month} ${month_of_year} ${day_of_week}`;
}
