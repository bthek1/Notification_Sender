import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import type { EChartsOption } from 'echarts'

const EChartsChart = lazy(() => import('@/components/charts/EChartsChart'))

export const Route = createFileRoute('/demo/chart')({
  component: ChartDemoPage,
})

const demoOption: EChartsOption = {
  grid: { top: 40, right: 20, bottom: 40, left: 50 },
  tooltip: { trigger: 'axis' },
  legend: { data: ['Series A', 'Series B'] },
  xAxis: { type: 'category', data: ['1', '2', '3', '4', '5'] },
  yAxis: { type: 'value' },
  series: [
    {
      name: 'Series A',
      type: 'line',
      smooth: true,
      data: [2, 6, 3, 8, 5],
    },
    {
      name: 'Series B',
      type: 'bar',
      data: [4, 3, 7, 1, 6],
    },
  ],
}

function ChartDemoPage() {
  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-6 text-2xl font-semibold">Chart Demo</h1>
      <Suspense
        fallback={<div className="text-muted-foreground">Loading chart…</div>}
      >
        <EChartsChart
          option={demoOption}
          className="h-96 w-full rounded-lg border"
        />
      </Suspense>
    </div>
  )
}
