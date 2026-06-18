import { describe, it, expect, vi, beforeEach } from 'vitest'
import { login, register, getMe } from './auth'

vi.mock('./client', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}))

describe('auth API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('login', () => {
    it('posts to /api/token/ and returns token pair', async () => {
      const { apiClient } = await import('./client')
      const tokens = { access: 'acc', refresh: 'ref' }
      vi.mocked(apiClient.post).mockResolvedValue({ data: tokens })

      const result = await login({ email: 'a@b.com', password: 'pass' })

      expect(apiClient.post).toHaveBeenCalledWith('/api/token/', {
        email: 'a@b.com',
        password: 'pass',
      })
      expect(result).toEqual(tokens)
    })
  })

  describe('register', () => {
    it('posts to /api/accounts/register/ and returns user', async () => {
      const { apiClient } = await import('./client')
      const user = { id: '1', email: 'a@b.com' }
      vi.mocked(apiClient.post).mockResolvedValue({ data: user })

      const result = await register({
        email: 'a@b.com',
        password: 'pass',
        confirm_password: 'pass',
      })

      expect(apiClient.post).toHaveBeenCalledWith('/api/accounts/register/', {
        email: 'a@b.com',
        password: 'pass',
        confirm_password: 'pass',
      })
      expect(result).toEqual(user)
    })
  })

  describe('getMe', () => {
    it('GETs /api/accounts/me/ and returns user', async () => {
      const { apiClient } = await import('./client')
      const user = { id: '1', email: 'a@b.com' }
      vi.mocked(apiClient.get).mockResolvedValue({ data: user })

      const result = await getMe()

      expect(apiClient.get).toHaveBeenCalledWith('/api/accounts/me/')
      expect(result).toEqual(user)
    })
  })
})
