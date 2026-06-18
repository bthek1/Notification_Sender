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
 * Thin wrapper around echarts-for-react. Size it via `className` / `style`:
 * those land on an outer box and the chart fills it. The chart canvas needs an
 * explicitly-sized parent — applying `height: 100%` directly to the ECharts root
 * (its old behaviour) let an inline height override sizing classes like `h-80`
 * and collapsed the chart to ECharts' ~100px default.
 */
export default function EChartsChart({
  option,
  className,
  style,
  notMerge = true,
}: EChartsChartProps) {
  return (
    <div className={className} style={style}>
      <ReactECharts
        option={option}
        notMerge={notMerge}
        lazyUpdate
        style={{ height: "100%", width: "100%" }}
      />
    </div>
  );
}
