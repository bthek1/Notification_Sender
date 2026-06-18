import { describe, it, expect, vi } from 'vitest'
import { themeTokens, getCSSVar, type ThemeToken } from './theme'

describe('themeTokens', () => {
  it('contains expected CSS variable names', () => {
    expect(themeTokens.background).toBe('--background')
    expect(themeTokens.primary).toBe('--primary')
    expect(themeTokens.border).toBe('--border')
  })
})

describe('getCSSVar', () => {
  it('reads the computed CSS variable for a given token', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (prop: string) =>
        prop === '--background' ? '  #ffffff  ' : '',
    } as unknown as CSSStyleDeclaration)

    const value = getCSSVar('background' as ThemeToken)
    expect(value).toBe('#ffffff')
  })

  it('returns empty string when the CSS variable is not set', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '',
    } as unknown as CSSStyleDeclaration)

    const value = getCSSVar('primary' as ThemeToken)
    expect(value).toBe('')
  })
})
