import { useMemo, useState } from "react";
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
import {
  EventsRangePicker,
  makeDefaultRange,
  type TimeRange,
} from "@/components/events/EventsRangePicker";
import { formatDateTime } from "@/lib/date";
import { useEvents, useGenerateEvents } from "@/hooks/useEvents";

export const Route = createFileRoute("/events")({
  component: EventsPage,
});

function EventsPage() {
  const { data: allEvents = [], isPending, isError, error } = useEvents();
  const generate = useGenerateEvents();
  const [range, setRange] = useState<TimeRange>(() => makeDefaultRange());

  // Restrict to the picked [from, to] range; the charts and table all render
  // from this filtered set. Bounds are normalised so an inverted range (end
  // before start) still yields a valid axis rather than breaking the charts.
  const { events, windowStartMs, windowEndMs } = useMemo(() => {
    const startMs = Math.min(range.startMs, range.endMs);
    const endMs = Math.max(range.startMs, range.endMs);
    return {
      windowStartMs: startMs,
      windowEndMs: endMs,
      events: allEvents.filter((e) => {
        const t = new Date(e.scheduled_time).getTime();
        return t >= startMs && t <= endMs;
      }),
    };
  }, [allEvents, range]);

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
          onClick={() => generate.mutate({ count: 10, within_minutes: 5 })}
          disabled={generate.isPending}
        >
          {generate.isPending ? "Generating…" : "Generate 10 events / 5 min"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Time range</CardTitle>
          <CardDescription>
            Showing events from {formatDateTime(new Date(windowStartMs))} to{" "}
            {formatDateTime(new Date(windowEndMs))}. Charts and table follow
            this range.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EventsRangePicker value={range} onChange={setRange} />
        </CardContent>
      </Card>

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
            <EventsChart
              events={events}
              windowStartMs={windowStartMs}
              windowEndMs={windowEndMs}
            />
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
            <DelayChart
              events={events}
              windowStartMs={windowStartMs}
              windowEndMs={windowEndMs}
            />
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
