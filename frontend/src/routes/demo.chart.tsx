import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import type { Data } from 'plotly.js'

const PlotlyChart = lazy(() => import('@/components/charts/PlotlyChart'))

export const Route = createFileRoute('/demo/chart')({
  component: ChartDemoPage,
})

const demoData: Data[] = [
  {
    type: 'scatter',
    mode: 'lines+markers',
    x: [1, 2, 3, 4, 5],
    y: [2, 6, 3, 8, 5],
    name: 'Series A',
  },
  {
    type: 'bar',
    x: [1, 2, 3, 4, 5],
    y: [4, 3, 7, 1, 6],
    name: 'Series B',
  },
]

function ChartDemoPage() {
  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-6 text-2xl font-semibold">Chart Demo</h1>
      <Suspense fallback={<div className="text-muted-foreground">Loading chart…</div>}>
        <PlotlyChart data={demoData} className="h-96 w-full rounded-lg border" />
      </Suspense>
    </div>
  )
}
