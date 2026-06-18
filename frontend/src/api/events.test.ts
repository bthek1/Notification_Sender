import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listEvents, generateEvents } from './events'

vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}))

describe('events API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listEvents', () => {
    it('GETs /api/notifications/events/ and returns the list', async () => {
      const { apiClient } = await import('./client')
      const events = [{ id: '1', title: 'E1' }]
      vi.mocked(apiClient.get).mockResolvedValue({ data: events })

      const result = await listEvents()

      expect(apiClient.get).toHaveBeenCalledWith('/api/notifications/events/')
      expect(result).toEqual(events)
    })
  })

  describe('generateEvents', () => {
    it('POSTs the payload to the generate endpoint', async () => {
      const { apiClient } = await import('./client')
      vi.mocked(apiClient.post).mockResolvedValue({ data: { task_id: 't-1' } })

      const result = await generateEvents({ count: 5, within_minutes: 20 })

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/notifications/events/generate/',
        { count: 5, within_minutes: 20 },
      )
      expect(result).toEqual({ task_id: 't-1' })
    })

    it('defaults to an empty payload when none is given', async () => {
      const { apiClient } = await import('./client')
      vi.mocked(apiClient.post).mockResolvedValue({ data: { task_id: 't-2' } })

      await generateEvents()

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/notifications/events/generate/',
        {},
      )
    })
  })
})
