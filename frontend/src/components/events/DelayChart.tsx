import { lazy, Suspense, useMemo } from "react";
import type { EChartsOption } from "echarts";

import type { NotificationEvent } from "@/types/events";
import { delayMs, formatDelay, formatTimePrecise } from "@/lib/date";

const EChartsChart = lazy(() => import("@/components/charts/EChartsChart"));

interface DelayChartProps {
  events: NotificationEvent[];
  windowStartMs: number;
  windowEndMs: number;
}

/** Severity colour for a delay magnitude: green < 1s, amber < 3s, red ≥ 3s. */
function delayColor(ms: number): string {
  if (ms < 1000) return "#22c55e";
  if (ms < 3000) return "#f59e0b";
  return "#ef4444";
}

/**
 * Bar chart of firing delay (`fired_at − scheduled_time`, in seconds) for every
 * event that has fired, plotted against its scheduled time. This is the direct
 * read-out of scheduling accuracy: taller bars are later fires. Pending events
 * have no delay yet and are omitted.
 */
function buildOption(
  events: NotificationEvent[],
  windowStartMs: number,
  windowEndMs: number,
): EChartsOption {
  const points = events
    .filter((e) => e.status === "fired" && e.fired_at)
    .map((e) => {
      const ms = delayMs(e.scheduled_time, e.fired_at) ?? 0;
      return {
        value: [e.scheduled_time, ms / 1000] as [string, number],
        name: e.title,
        scheduledTime: e.scheduled_time,
        firedAt: e.fired_at,
        itemStyle: { color: delayColor(ms) },
      };
    });

  const avgSeconds =
    points.reduce((sum, p) => sum + p.value[1], 0) / (points.length || 1);

  return {
    grid: { top: 24, right: 24, bottom: 50, left: 64 },
    tooltip: {
      trigger: "item",
      formatter: (params: unknown) => {
        const p = params as {
          name: string;
          data: { scheduledTime: string; firedAt: string | null };
        };
        const { scheduledTime, firedAt } = p.data;
        return (
          `<strong>${p.name}</strong>` +
          `<br/>Scheduled: ${formatTimePrecise(scheduledTime)}` +
          `<br/>Fired: ${formatTimePrecise(firedAt)}` +
          `<br/>Delay: <strong>${formatDelay(scheduledTime, firedAt)}</strong>`
        );
      },
    },
    xAxis: {
      type: "time",
      name: "Scheduled time",
      nameLocation: "middle",
      nameGap: 30,
      min: windowStartMs,
      max: windowEndMs,
      axisLabel: {
        formatter: { hour: "{HH}:{mm}:{ss}", minute: "{HH}:{mm}:{ss}" },
      },
    },
    yAxis: {
      type: "value",
      name: "Delay (s)",
      nameLocation: "middle",
      nameGap: 44,
      min: 0,
    },
    dataZoom: [{ type: "inside" }],
    series: [
      {
        name: "delay",
        type: "bar",
        barMaxWidth: 24,
        data: points,
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#64748b", type: "dashed" },
          label: {
            formatter: `avg ${avgSeconds.toFixed(2)}s`,
            position: "insideEndTop",
            color: "#64748b",
          },
          data: [{ yAxis: avgSeconds }],
        },
      },
    ],
  };
}

export function DelayChart({
  events,
  windowStartMs,
  windowEndMs,
}: DelayChartProps) {
  const option = useMemo(
    () => buildOption(events, windowStartMs, windowEndMs),
    [events, windowStartMs, windowEndMs],
  );

  const hasFired = events.some((e) => e.status === "fired" && e.fired_at);
  if (!hasFired) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No fired events yet — delays appear once events fire.
      </p>
    );
  }

  return (
    <Suspense
      fallback={<div className="text-muted-foreground">Loading chart…</div>}
    >
      <EChartsChart option={option} className="h-80 w-full" />
    </Suspense>
  );
}
