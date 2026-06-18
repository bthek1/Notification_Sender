import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAuthStore } from './auth'

describe('useAuthStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useAuthStore.setState({ isLoggingOut: false })
  })

  it('initialises with isLoggingOut false', () => {
    const { result } = renderHook(() => useAuthStore())
    expect(result.current.isLoggingOut).toBe(false)
  })

  it('setIsLoggingOut(true) sets isLoggingOut to true', () => {
    const { result } = renderHook(() => useAuthStore())
    act(() => {
      result.current.setIsLoggingOut(true)
    })
    expect(result.current.isLoggingOut).toBe(true)
  })

  it('setIsLoggingOut(false) resets isLoggingOut', () => {
    useAuthStore.setState({ isLoggingOut: true })
    const { result } = renderHook(() => useAuthStore())
    act(() => {
      result.current.setIsLoggingOut(false)
    })
    expect(result.current.isLoggingOut).toBe(false)
  })
})
