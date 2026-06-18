import { describe, it, expect } from 'vitest'
import { formatDate, formatDateTime, formatRelative } from './date'

describe('formatDate', () => {
  it('returns empty string for null', () => {
    expect(formatDate(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(formatDate(undefined)).toBe('')
  })

  it('returns empty string for an invalid ISO string', () => {
    expect(formatDate('not-a-date')).toBe('')
  })

  it('formats a valid ISO date string with default format', () => {
    expect(formatDate('2024-06-15')).toBe('15 Jun 2024')
  })

  it('formats a Date object with default format', () => {
    expect(formatDate(new Date('2024-01-01'))).toBe('01 Jan 2024')
  })

  it('accepts a custom format string', () => {
    expect(formatDate('2024-12-25', 'MM/dd/yyyy')).toBe('12/25/2024')
  })
})

describe('formatDateTime', () => {
  it('returns empty string for null', () => {
    expect(formatDateTime(null)).toBe('')
  })

  it('returns empty string for an invalid date', () => {
    expect(formatDateTime('garbage')).toBe('')
  })

  it('includes time component in output', () => {
    // Use a fixed UTC timestamp and check that it contains a time portion
    const result = formatDateTime(new Date(2024, 5, 15, 9, 30)) // local time
    expect(result).toMatch(/15 Jun 2024, \d{2}:30/)
  })
})

describe('formatRelative', () => {
  it('returns empty string for null', () => {
    expect(formatRelative(null)).toBe('')
  })

  it('returns empty string for an invalid date', () => {
    expect(formatRelative('bad')).toBe('')
  })

  it('returns a relative time string for a past date', () => {
    const pastDate = new Date(Date.now() - 1000 * 60 * 60 * 3) // 3 hours ago
    const result = formatRelative(pastDate)
    expect(result).toMatch(/ago/)
  })

  it('accepts an ISO string', () => {
    const result = formatRelative('2020-01-01T00:00:00Z')
    expect(result).toMatch(/ago|years/)
  })
})
