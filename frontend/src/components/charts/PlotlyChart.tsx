import { useEffect, useRef } from "react";
import type { Data, Layout, Config } from "plotly.js";

// Cache the dynamic import so Plotly is only loaded once
const plotlyPromise = import("plotly.js-dist-min");

interface PlotlyChartProps {
  data: Data[];
  layout?: Partial<Layout>;
  config?: Partial<Config>;
  className?: string;
}

export default function PlotlyChart({
  data,
  layout,
  config,
  className,
}: PlotlyChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    plotlyPromise.then((Plotly) => {
      if (cancelled || !containerRef.current) return;
      Plotly.newPlot(
        containerRef.current,
        data,
        { margin: { t: 40, r: 20, b: 40, l: 50 }, ...layout },
        { responsive: true, displaylogo: false, ...config },
      );
    });

    return () => {
      cancelled = true;
      if (containerRef.current) {
        plotlyPromise.then((Plotly) => {
          if (containerRef.current) Plotly.purge(containerRef.current);
        });
      }
    };
  }, [data, layout, config]);

  return <div ref={containerRef} className={className} />;
}
