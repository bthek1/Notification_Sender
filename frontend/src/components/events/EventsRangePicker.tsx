import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** An absolute time range to show events for. The Events page filters its data
 * — and the charts set their x-axis bounds — from this. */
export interface TimeRange {
  startMs: number;
  endMs: number;
}

/** Half-width of the default range either side of "now", in minutes. */
export const DEFAULT_WINDOW_MINUTES = 10;

/** A range spanning ±`minutes` around `nowMs` (default: now). */
export function rangeAround(
  minutes: number,
  nowMs: number = Date.now(),
): TimeRange {
  const span = minutes * 60_000;
  return { startMs: nowMs - span, endMs: nowMs + span };
}

export function makeDefaultRange(nowMs: number = Date.now()): TimeRange {
  return rangeAround(DEFAULT_WINDOW_MINUTES, nowMs);
}

const PRESETS = [10, 30, 60] as const;

/** ms → a `datetime-local`-compatible string in the viewer's local time,
 * including seconds (the inputs use `step="1"`). */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Parse a `datetime-local` value (local time) back to epoch ms, or null. */
function fromLocalInput(value: string): number | null {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

interface EventsRangePickerProps {
  value: TimeRange;
  onChange: (next: TimeRange) => void;
}

/**
 * From/To time range picker for the Events page. Two `datetime-local` inputs
 * set the exact bounds; the quick presets re-centre a ± span on the current
 * time. Everything downstream — timeline, delay chart, table, and counts —
 * follows the chosen range.
 */
export function EventsRangePicker({ value, onChange }: EventsRangePickerProps) {
  return (
    <div
      className="flex flex-wrap items-end gap-x-6 gap-y-3"
      data-testid="events-range-picker"
    >
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>From</span>
        <Input
          type="datetime-local"
          step="1"
          className="w-52"
          value={toLocalInput(value.startMs)}
          onChange={(e) => {
            const ms = fromLocalInput(e.target.value);
            if (ms !== null) onChange({ ...value, startMs: ms });
          }}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>To</span>
        <Input
          type="datetime-local"
          step="1"
          className="w-52"
          value={toLocalInput(value.endMs)}
          onChange={(e) => {
            const ms = fromLocalInput(e.target.value);
            if (ms !== null) onChange({ ...value, endMs: ms });
          }}
        />
      </label>

      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Around now</span>
        <div className="flex gap-1">
          {PRESETS.map((minutes) => (
            <Button
              key={minutes}
              type="button"
              size="xs"
              variant="outline"
              onClick={() => onChange(rangeAround(minutes))}
            >
              ±{minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
