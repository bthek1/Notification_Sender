import { lazy, Suspense, useMemo } from "react";
import type { EChartsOption } from "echarts";

import type { NotificationEvent } from "@/types/events";
import { formatDelay, formatTimePrecise } from "@/lib/date";

const EChartsChart = lazy(() => import("@/components/charts/EChartsChart"));

interface EventsChartProps {
  events: NotificationEvent[];
}

const STATUS_ROWS = ["fired", "pending"] as const;

/**
 * Timeline scatter of events: x-axis is the scheduled time, points are split
 * into "pending" and "fired" rows so the distribution of upcoming vs. already
 * fired events over time is visible at a glance.
 */
function buildOption(events: NotificationEvent[], nowMs: number): EChartsOption {
  const toPoint = (e: NotificationEvent) => ({
    value: [e.scheduled_time, e.status] as [string, string],
    name: e.title,
    scheduledTime: e.scheduled_time,
    firedAt: e.fired_at,
  });

  return {
    grid: { top: 50, right: 24, bottom: 50, left: 80 },
    tooltip: {
      trigger: "item",
      formatter: (params: unknown) => {
        const p = params as {
          name: string;
          value: [string, string];
          data: { scheduledTime: string; firedAt: string | null };
        };
        const { scheduledTime, firedAt } = p.data;
        const scheduled = formatTimePrecise(scheduledTime);
        const fired = firedAt ? formatTimePrecise(firedAt) : "—";
        const delay = firedAt
          ? `<br/>Delay: <strong>${formatDelay(scheduledTime, firedAt)}</strong>`
          : "";
        return (
          `<strong>${p.name}</strong> · ${p.value[1]}` +
          `<br/>Scheduled: ${scheduled}` +
          `<br/>Fired: ${fired}${delay}`
        );
      },
    },
    legend: { data: ["pending", "fired"], top: 8 },
    xAxis: {
      type: "time",
      name: "Scheduled time",
      nameLocation: "middle",
      nameGap: 30,
      axisLabel: {
        formatter: { hour: "{HH}:{mm}:{ss}", minute: "{HH}:{mm}:{ss}" },
      },
    },
    yAxis: {
      type: "category",
      data: [...STATUS_ROWS],
    },
    series: [
      {
        name: "pending",
        type: "scatter",
        symbolSize: 14,
        itemStyle: { color: "#f59e0b" },
        // A vertical "now" line: events left of it are overdue/fired, those to
        // the right are still upcoming. Attached to one series only so it draws
        // once.
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#64748b", type: "dashed" },
          label: { formatter: "now", position: "end", color: "#64748b" },
          data: [{ xAxis: nowMs }],
        },
        data: events
          .filter((e) => e.status === "pending")
          .map(toPoint),
      },
      {
        name: "fired",
        type: "scatter",
        symbolSize: 14,
        itemStyle: { color: "#22c55e" },
        data: events.filter((e) => e.status === "fired").map(toPoint),
      },
    ],
  };
}

export function EventsChart({ events }: EventsChartProps) {
  // Recomputes on each refetch (events identity changes), keeping the "now"
  // line roughly current without a separate ticker.
  const option = useMemo(() => buildOption(events, Date.now()), [events]);

  return (
    <Suspense
      fallback={<div className="text-muted-foreground">Loading chart…</div>}
    >
      <EChartsChart option={option} className="h-80 w-full" />
    </Suspense>
  );
}
