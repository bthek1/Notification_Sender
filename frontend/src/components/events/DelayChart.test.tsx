import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EChartsOption } from "echarts";

import { DelayChart } from "./DelayChart";
import type { NotificationEvent } from "@/types/events";

const capturedOptions: EChartsOption[] = [];
vi.mock("@/components/charts/EChartsChart", () => ({
  default: ({ option }: { option: EChartsOption }) => {
    capturedOptions.push(option);
    return <div data-testid="echarts" />;
  },
}));

function makeEvent(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    id: "1",
    title: "Generated event 1",
    message: "msg",
    scheduled_time: "2026-06-18T05:24:00.000Z",
    status: "pending",
    fired_at: null,
    created_at: "2026-06-18T05:20:00Z",
    updated_at: "2026-06-18T05:20:00Z",
    ...overrides,
  };
}

function delaySeries() {
  const option = capturedOptions.at(-1)!;
  const series = option.series as Array<{ name: string; data: unknown[] }>;
  return series.find((s) => s.name === "delay")!;
}

describe("DelayChart", () => {
  beforeEach(() => {
    capturedOptions.length = 0;
  });

  it("shows an empty state when nothing has fired", () => {
    render(<DelayChart events={[makeEvent({ status: "pending" })]} />);
    expect(screen.getByText(/no fired events yet/i)).toBeInTheDocument();
  });

  it("plots only fired events, with delay in seconds", async () => {
    render(
      <DelayChart
        events={[
          makeEvent({ id: "1", status: "pending" }),
          makeEvent({
            id: "2",
            status: "fired",
            scheduled_time: "2026-06-18T05:24:00.000Z",
            fired_at: "2026-06-18T05:24:03.210Z",
          }),
        ]}
      />,
    );

    await waitFor(() => expect(capturedOptions.length).toBeGreaterThan(0));

    const series = delaySeries();
    expect(series.data).toHaveLength(1);
    const point = series.data[0] as { value: [string, number] };
    expect(point.value[1]).toBeCloseTo(3.21, 3);
  });
});
