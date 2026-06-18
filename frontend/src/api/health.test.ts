import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getHealth } from './health'

vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}))

describe('health API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GETs /api/health/ and returns status object', async () => {
    const { apiClient } = await import('./client')
    vi.mocked(apiClient.get).mockResolvedValue({ data: { status: 'ok' } })

    const result = await getHealth()

    expect(apiClient.get).toHaveBeenCalledWith('/api/health/')
    expect(result).toEqual({ status: 'ok' })
  })
})
