import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    createFileRoute: vi.fn().mockImplementation((path: string) => (opts: Record<string, unknown>) => ({ path, options: opts })),
    useNavigate: vi.fn().mockReturnValue(mockNavigate),
    Link: ({ children, to, ...props }: { children: ReactNode; to: string; [key: string]: unknown }) => (
      <a href={to} {...props}>{children}</a>
    ),
  }
})

const mockUseMe = vi.fn().mockReturnValue({ data: undefined })

vi.mock('@/hooks/useAuth', () => ({
  useMe: () => mockUseMe(),
  useLogin: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/useTheme', () => ({
  useTheme: vi.fn().mockReturnValue({ theme: 'light', setTheme: vi.fn() }),
}))

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const { Route } = await import('@/routes/index')
const LandingPage = Route?.options?.component as React.ComponentType | undefined

describe('LandingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMe.mockReturnValue({ data: undefined })
  })

  it('renders the hero banner heading', () => {
    if (!LandingPage) throw new Error('LandingPage component not found')
    render(<LandingPage />, { wrapper })
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('renders sign-in and create account links', () => {
    if (!LandingPage) throw new Error('LandingPage component not found')
    render(<LandingPage />, { wrapper })
    expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create account/i })).toBeInTheDocument()
  })

  it('does not redirect when user is not authenticated', () => {
    if (!LandingPage) throw new Error('LandingPage component not found')
    mockUseMe.mockReturnValue({ data: undefined })
    render(<LandingPage />, { wrapper })
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('redirects to /demo/chart when user is authenticated', () => {
    if (!LandingPage) throw new Error('LandingPage component not found')
    mockUseMe.mockReturnValue({ data: { id: '1', email: 'a@b.com' } })
    render(<LandingPage />, { wrapper })
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/demo/chart' })
  })
})
