import { createFileRoute } from "@tanstack/react-router";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SchedulesTable } from "@/components/tasks/SchedulesTable";
import { useSchedules } from "@/hooks/useSchedules";

export const Route = createFileRoute("/schedules")({
  component: SchedulesPage,
});

function SchedulesPage() {
  const { data: schedules = [], isPending, isError, error } = useSchedules();

  const enabledCount = schedules.filter((s) => s.enabled).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Scheduled tasks</h1>
        <p className="text-sm text-muted-foreground">
          {schedules.length} total · {enabledCount} enabled · backed by Celery
          beat (DatabaseScheduler)
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Periodic tasks</CardTitle>
          <CardDescription>
            Schedules stored in the database and re-read by beat at runtime.
            Toggle a task on/off or fire it immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isError ? (
            <p className="py-8 text-center text-sm text-destructive">
              Failed to load scheduled tasks:{" "}
              {error instanceof Error ? error.message : "unknown error"}
            </p>
          ) : isPending ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading scheduled tasks…
            </p>
          ) : (
            <SchedulesTable schedules={schedules} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
