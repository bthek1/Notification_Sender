import axios from 'axios'
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'

// Make the instance both callable (for retried requests) and have interceptors
const mockRequest = { use: vi.fn() }
const mockResponse = { use: vi.fn() }
const mockRetryFn = vi.fn().mockResolvedValue({ data: 'retried' })
const mockAxiosInstance = Object.assign(mockRetryFn, {
  interceptors: { request: mockRequest, response: mockResponse },
})
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>()
  return {
    ...actual,
    default: {
      ...actual.default,
      create: vi.fn(() => mockAxiosInstance),
      post: vi.fn(),
    },
  }
})

// Interceptors are registered once when the module is imported for the first time.
type RequestHandler = (config: { headers: Record<string, string> }) => { headers: Record<string, string> }
type ResponseSuccess = (res: unknown) => unknown
type ResponseError = (err: unknown) => Promise<unknown>

let requestFulfilled: RequestHandler
let responseFulfilled: ResponseSuccess
let responseRejected: ResponseError

beforeAll(async () => {
  await import('./client')
  requestFulfilled = mockRequest.use.mock.calls[0][0] as RequestHandler
  ;[responseFulfilled, responseRejected] = mockResponse.use.mock.calls[0] as [ResponseSuccess, ResponseError]
})

afterEach(() => {
  localStorage.clear()
})

describe('apiClient interceptors', () => {
  it('registers exactly one request interceptor', () => {
    expect(mockRequest.use).toHaveBeenCalledTimes(1)
  })

  it('registers exactly one response interceptor', () => {
    expect(mockResponse.use).toHaveBeenCalledTimes(1)
  })

  it('request interceptor attaches Bearer token when access_token is present', () => {
    localStorage.setItem('access_token', 'my-token')
    const config = { headers: {} as Record<string, string> }
    const result = requestFulfilled(config)
    expect(result.headers.Authorization).toBe('Bearer my-token')
  })

  it('request interceptor does not attach token when absent', () => {
    const config = { headers: {} as Record<string, string> }
    const result = requestFulfilled(config)
    expect(result.headers.Authorization).toBeUndefined()
  })

  it('response interceptor passes through successful responses', () => {
    const response = { data: 'ok' }
    expect(responseFulfilled(response)).toBe(response)
  })

  it('response interceptor clears tokens and rejects on refresh failure', async () => {
    localStorage.setItem('access_token', 'old-acc')
    localStorage.setItem('refresh_token', 'old-ref')

    const axiosMod = axios as unknown as { post: ReturnType<typeof vi.fn> }
    axiosMod.post = vi.fn().mockRejectedValue(new Error('network'))

    const error = {
      response: { status: 401 },
      config: { _retry: false, headers: {} as Record<string, string> },
    }

    await expect(responseRejected(error)).rejects.toThrow()
    expect(localStorage.getItem('access_token')).toBeNull()
    expect(localStorage.getItem('refresh_token')).toBeNull()
  })

  it('response interceptor stores new access token after successful refresh', async () => {
    localStorage.setItem('refresh_token', 'my-ref')

    const axiosMod = axios as unknown as { post: ReturnType<typeof vi.fn> }
    axiosMod.post = vi.fn().mockResolvedValue({ data: { access: 'new-acc' } })

    const error = {
      response: { status: 401 },
      config: { _retry: false, headers: {} as Record<string, string> },
    }

    await responseRejected(error)

    expect(axiosMod.post).toHaveBeenCalled()
    expect(localStorage.getItem('access_token')).toBe('new-acc')
  })

  it('response interceptor rejects non-401 errors immediately', async () => {
    const error = { response: { status: 500 }, config: {} }
    await expect(responseRejected(error)).rejects.toEqual(error)
  })

  it('response interceptor does not retry a request a second time (_retry guard)', async () => {
    const axiosMod = axios as unknown as { post: ReturnType<typeof vi.fn> }
    axiosMod.post = vi.fn()

    const error = {
      response: { status: 401 },
      config: { _retry: true, headers: {} as Record<string, string> },
    }

    await expect(responseRejected(error)).rejects.toEqual(error)
    expect(axiosMod.post).not.toHaveBeenCalled()
  })
})
