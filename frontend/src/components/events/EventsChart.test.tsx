import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EChartsOption } from 'echarts'

import { EventsChart } from './EventsChart'
import type { NotificationEvent } from '@/types/events'

// Capture the option handed to the (lazy) chart wrapper instead of rendering
// the heavy canvas-based ECharts component.
const capturedOptions: EChartsOption[] = []
vi.mock('@/components/charts/EChartsChart', () => ({
  default: ({ option }: { option: EChartsOption }) => {
    capturedOptions.push(option)
    return <div data-testid="echarts" />
  },
}))

function makeEvent(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    id: '1',
    title: 'Generated event 1',
    message: 'msg',
    scheduled_time: '2026-06-18T05:24:00Z',
    status: 'pending',
    fired_at: null,
    created_at: '2026-06-18T05:20:00Z',
    updated_at: '2026-06-18T05:20:00Z',
    ...overrides,
  }
}

function lastSeries() {
  const option = capturedOptions.at(-1)!
  return option.series as Array<{ name: string; data: unknown[] }>
}

describe('EventsChart', () => {
  beforeEach(() => {
    capturedOptions.length = 0
  })

  it('renders the chart wrapper', async () => {
    const { findByTestId } = render(<EventsChart events={[makeEvent()]} />)
    expect(await findByTestId('echarts')).toBeInTheDocument()
  })

  it('splits events into pending and fired series', async () => {
    render(
      <EventsChart
        events={[
          makeEvent({ id: '1', status: 'pending' }),
          makeEvent({ id: '2', status: 'pending' }),
          makeEvent({ id: '3', status: 'fired' }),
        ]}
      />,
    )

    await waitFor(() => expect(capturedOptions.length).toBeGreaterThan(0))

    const series = lastSeries()
    const pending = series.find((s) => s.name === 'pending')!
    const fired = series.find((s) => s.name === 'fired')!
    expect(pending.data).toHaveLength(2)
    expect(fired.data).toHaveLength(1)
  })

  it('produces empty series when there are no events', async () => {
    render(<EventsChart events={[]} />)

    await waitFor(() => expect(capturedOptions.length).toBeGreaterThan(0))

    const series = lastSeries()
    expect(series.every((s) => s.data.length === 0)).toBe(true)
  })
})
