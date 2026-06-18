import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { useEvents, useGenerateEvents } from './useEvents'
import { queryKeys } from '@/api/queryKeys'
import type { NotificationEvent } from '@/types/events'

vi.mock('@/api/events', () => ({
  listEvents: vi.fn(),
  generateEvents: vi.fn(),
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

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
  return { queryClient, Wrapper }
}

describe('useEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches and returns the event list', async () => {
    const { listEvents } = await import('@/api/events')
    vi.mocked(listEvents).mockResolvedValue([makeEvent({ id: 'a' })])

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useEvents(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data?.[0].id).toBe('a')
  })

  it('surfaces errors from the API', async () => {
    const { listEvents } = await import('@/api/events')
    vi.mocked(listEvents).mockRejectedValue(new Error('boom'))

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useEvents(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('useGenerateEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls generateEvents with the payload', async () => {
    const { generateEvents } = await import('@/api/events')
    vi.mocked(generateEvents).mockResolvedValue({ task_id: 't-1' })

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useGenerateEvents(), { wrapper: Wrapper })

    result.current.mutate({ count: 5, within_minutes: 20 })

    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(generateEvents).toHaveBeenCalledWith({ count: 5, within_minutes: 20 })
  })

  it('invalidates the events query after a short delay on success', async () => {
    const { generateEvents } = await import('@/api/events')
    vi.mocked(generateEvents).mockResolvedValue({ task_id: 't-1' })

    const { queryClient, Wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useGenerateEvents(), { wrapper: Wrapper })
    result.current.mutate({})

    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true))

    // Invalidation is deferred behind a setTimeout to give the worker a head start.
    expect(invalidateSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.events.all })
  })
})
