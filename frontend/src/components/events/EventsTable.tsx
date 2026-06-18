import { cn } from "@/lib/utils";
import { formatDateTime, formatRelative } from "@/lib/date";
import type { NotificationEvent } from "@/types/events";

interface EventsTableProps {
  events: NotificationEvent[];
}

function StatusBadge({ status }: { status: NotificationEvent["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        status === "fired"
          ? "bg-green-500/15 text-green-600 dark:text-green-400"
          : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
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
            <th className="px-3 py-2 font-medium">Scheduled</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Fired</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="border-b last:border-0">
              <td className="px-3 py-2 font-medium">{event.title}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {formatDateTime(event.scheduled_time)}
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={event.status} />
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {event.fired_at ? formatRelative(event.fired_at) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
