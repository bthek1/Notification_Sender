import { cn } from "@/lib/utils";
import { delayMs, formatDelay, formatTimePrecise } from "@/lib/date";
import type { NotificationEvent } from "@/types/events";

interface EventsTableProps {
  events: NotificationEvent[];
}

const STATUS_STYLES: Record<NotificationEvent["status"], string> = {
  fired: "bg-green-500/15 text-green-600 dark:text-green-400",
  scheduled: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  pending: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
};

function StatusBadge({ status }: { status: NotificationEvent["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status],
      )}
    >
      {status}
    </span>
  );
}

export function EventsTable({ events }: EventsTableProps) {
  if (events.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No events yet. Generate some to get started.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="px-3 py-2 font-medium">Title</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Scheduled</th>
            <th className="px-3 py-2 font-medium">Fired</th>
            <th className="px-3 py-2 text-right font-medium">Delay</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const delay = delayMs(event.scheduled_time, event.fired_at);
            return (
              <tr key={event.id} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{event.title}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={event.status} />
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {formatTimePrecise(event.scheduled_time)}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {event.fired_at ? formatTimePrecise(event.fired_at) : "—"}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right font-mono text-xs",
                    delay === null
                      ? "text-muted-foreground"
                      : delay > 0
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-green-600 dark:text-green-400",
                  )}
                >
                  {formatDelay(event.scheduled_time, event.fired_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
