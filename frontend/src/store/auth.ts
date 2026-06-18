import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

/**
 * Client-side auth flags only — server state (user profile, tokens)
 * lives in TanStack Query / localStorage, not here.
 */
interface AuthState {
  isLoggingOut: boolean
  setIsLoggingOut: (val: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  immer((set) => ({
    isLoggingOut: false,
    setIsLoggingOut: (val) =>
      set((s) => {
        s.isLoggingOut = val
      }),
  }))
)
