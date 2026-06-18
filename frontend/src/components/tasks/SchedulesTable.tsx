import { Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/date";
import { describeSchedule } from "@/lib/schedule";
import { useToggleSchedule, useTriggerSchedule } from "@/hooks/useSchedules";
import type { PeriodicTask } from "@/types/tasks";

interface SchedulesTableProps {
  schedules: PeriodicTask[];
}

function EnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        enabled
          ? "bg-green-500/15 text-green-600 dark:text-green-400"
          : "bg-muted text-muted-foreground",
      )}
    >
      {enabled ? "enabled" : "disabled"}
    </span>
  );
}

function ScheduleRow({ task }: { task: PeriodicTask }) {
  const toggle = useToggleSchedule();
  const trigger = useTriggerSchedule();

  return (
    <tr className="border-b last:border-0">
      <td className="px-3 py-2 font-medium">{task.name}</td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
        {task.task}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {describeSchedule(task.schedule)}
          {task.one_off && (
            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 font-sans text-[10px] font-medium text-amber-600 dark:text-amber-400">
              one-off
            </span>
          )}
        </span>
      </td>
      <td className="px-3 py-2">
        <EnabledBadge enabled={task.enabled} />
      </td>
      <td className="px-3 py-2 text-muted-foreground">
        {task.last_run_at ? formatRelative(task.last_run_at) : "never"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {task.total_run_count}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => trigger.mutate(task.id)}
            disabled={trigger.isPending}
          >
            <Play className="h-3.5 w-3.5" />
            Run now
          </Button>
          <Button
            size="sm"
            variant={task.enabled ? "ghost" : "default"}
            onClick={() =>
              toggle.mutate({ id: task.id, enabled: !task.enabled })
            }
            disabled={toggle.isPending}
          >
            {task.enabled ? "Disable" : "Enable"}
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function SchedulesTable({ schedules }: SchedulesTableProps) {
  if (schedules.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No scheduled tasks yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Task</th>
            <th className="px-3 py-2 font-medium">Schedule</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Last run</th>
            <th className="px-3 py-2 text-right font-medium">Runs</th>
            <th className="px-3 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {schedules.map((task) => (
            <ScheduleRow key={task.id} task={task} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
