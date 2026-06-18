import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useLogin, useMe, useRegister, useLogout } from './useAuth'

// Mock the Axios client so no real HTTP calls are made
vi.mock('../api/client', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}))

vi.mock('../api/auth', () => ({
  login: vi.fn(),
  register: vi.fn(),
  getMe: vi.fn(),
}))

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useLogin', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('exposes a mutate function', () => {
    const { result } = renderHook(() => useLogin(), { wrapper })
    expect(typeof result.current.mutate).toBe('function')
  })

  it('stores tokens in localStorage on success', async () => {
    const { login } = await import('../api/auth')
    vi.mocked(login).mockResolvedValue({ access: 'acc-tok', refresh: 'ref-tok' })

    const { result } = renderHook(() => useLogin(), { wrapper })
    result.current.mutate({ email: 'test@example.com', password: 'secret123' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(localStorage.getItem('access_token')).toBe('acc-tok')
    expect(localStorage.getItem('refresh_token')).toBe('ref-tok')
  })
})

describe('useMe', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('is disabled when no access_token is in localStorage', () => {
    const { result } = renderHook(() => useMe(), { wrapper })
    // fetchStatus idle means query was never submitted
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('calls getMe and returns user data when a token exists', async () => {
    const { getMe } = await import('../api/auth')
    const user = { id: '1', email: 'user@example.com' }
    vi.mocked(getMe).mockResolvedValue(user as never)
    localStorage.setItem('access_token', 'tok')

    const { result } = renderHook(() => useMe(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(user)
  })
})

describe('useRegister', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exposes a mutate function', () => {
    const { result } = renderHook(() => useRegister(), { wrapper })
    expect(typeof result.current.mutate).toBe('function')
  })

  it('calls register with the supplied payload', async () => {
    const { register } = await import('../api/auth')
    const user = { id: '2', email: 'new@example.com' }
    vi.mocked(register).mockResolvedValue(user as never)

    const { result } = renderHook(() => useRegister(), { wrapper })
    result.current.mutate({ email: 'new@example.com', password: 'pass1234', confirm_password: 'pass1234' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(user)
  })
})

describe('useLogout', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('returns a function', () => {
    const { result } = renderHook(() => useLogout(), { wrapper })
    expect(typeof result.current).toBe('function')
  })

  it('clears access_token and refresh_token from localStorage', () => {
    localStorage.setItem('access_token', 'acc')
    localStorage.setItem('refresh_token', 'ref')

    const { result } = renderHook(() => useLogout(), { wrapper })
    act(() => {
      result.current()
    })

    expect(localStorage.getItem('access_token')).toBeNull()
    expect(localStorage.getItem('refresh_token')).toBeNull()
  })
})
