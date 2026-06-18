import type { CSSProperties } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

interface EChartsChartProps {
  option: EChartsOption;
  className?: string;
  style?: CSSProperties;
  /** Replace the chart (vs. merge) when the option changes. */
  notMerge?: boolean;
}

/**
 * Thin wrapper around echarts-for-react. The chart auto-resizes to its
 * container; size it via `className` / `style` on the wrapping element.
 */
export default function EChartsChart({
  option,
  className,
  style,
  notMerge = true,
}: EChartsChartProps) {
  return (
    <ReactECharts
      option={option}
      notMerge={notMerge}
      lazyUpdate
      className={className}
      style={{ height: "100%", width: "100%", ...style }}
    />
  );
}
