import { createFileRoute } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EventsChart } from "@/components/events/EventsChart";
import { DelayChart } from "@/components/events/DelayChart";
import { EventsTable } from "@/components/events/EventsTable";
import { useEvents, useGenerateEvents } from "@/hooks/useEvents";

export const Route = createFileRoute("/events")({
  component: EventsPage,
});

function EventsPage() {
  const { data: events = [], isPending, isError, error } = useEvents();
  const generate = useGenerateEvents();

  const pendingCount = events.filter((e) => e.status === "pending").length;
  const firedCount = events.length - pendingCount;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Events</h1>
          <p className="text-sm text-muted-foreground">
            {events.length} total · {pendingCount} pending · {firedCount} fired
          </p>
        </div>
        <Button
          onClick={() => generate.mutate({ count: 5, within_minutes: 20 })}
          disabled={generate.isPending}
        >
          {generate.isPending ? "Generating…" : "Generate 5 events / 20 min"}
        </Button>
      </div>

      {generate.isError && (
        <p className="text-sm text-destructive">
          Failed to generate events:{" "}
          {generate.error instanceof Error
            ? generate.error.message
            : "unknown error"}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
          <CardDescription>
            Events plotted by scheduled time, split by status.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isError ? (
            <p className="py-8 text-center text-sm text-destructive">
              Failed to load events:{" "}
              {error instanceof Error ? error.message : "unknown error"}
            </p>
          ) : isPending ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading events…
            </p>
          ) : (
            <EventsChart events={events} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Firing delay</CardTitle>
          <CardDescription>
            How late each event fired (fired time − scheduled time), in seconds.
            Bars are green under 1s, amber under 3s, red beyond; the dashed line
            marks the average.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isError ? (
            <p className="py-8 text-center text-sm text-destructive">
              Failed to load events.
            </p>
          ) : isPending ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading events…
            </p>
          ) : (
            <DelayChart events={events} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All events</CardTitle>
          <CardDescription>Ordered by scheduled time.</CardDescription>
        </CardHeader>
        <CardContent>
          {isError ? (
            <p className="py-8 text-center text-sm text-destructive">
              Failed to load events.
            </p>
          ) : isPending ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading events…
            </p>
          ) : (
            <EventsTable events={events} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
