import { lazy, Suspense, useMemo } from "react";
import type { EChartsOption } from "echarts";

import type { NotificationEvent } from "@/types/events";

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
function buildOption(events: NotificationEvent[]): EChartsOption {
  const toPoint = (e: NotificationEvent) => ({
    value: [e.scheduled_time, e.status] as [string, string],
    name: e.title,
  });

  return {
    grid: { top: 50, right: 24, bottom: 50, left: 80 },
    tooltip: {
      trigger: "item",
      formatter: (params: unknown) => {
        const p = params as { name: string; value: [string, string] };
        const when = new Date(p.value[0]).toLocaleString();
        return `<strong>${p.name}</strong><br/>${p.value[1]} · ${when}`;
      },
    },
    legend: { data: ["pending", "fired"], top: 8 },
    xAxis: {
      type: "time",
      name: "Scheduled time",
      nameLocation: "middle",
      nameGap: 30,
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
  const option = useMemo(() => buildOption(events), [events]);

  return (
    <Suspense
      fallback={<div className="text-muted-foreground">Loading chart…</div>}
    >
      <EChartsChart option={option} className="h-80 w-full" />
    </Suspense>
  );
}
