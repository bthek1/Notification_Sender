import {
  format,
  formatDistanceToNow,
  parseISO,
  isValid,
  type Locale,
} from 'date-fns'

const DEFAULT_FORMAT = 'dd MMM yyyy'
const DATETIME_FORMAT = 'dd MMM yyyy, HH:mm'
const TIME_PRECISE_FORMAT = 'HH:mm:ss.SSS'

/**
 * Format an ISO date string or Date object to a human-readable date.
 * Falls back to an empty string if the date is invalid.
 */
export function formatDate(
  date: string | Date | null | undefined,
  fmt: string = DEFAULT_FORMAT,
  options?: { locale?: Locale }
): string {
  if (!date) return ''
  const d = typeof date === 'string' ? parseISO(date) : date
  if (!isValid(d)) return ''
  return format(d, fmt, options)
}

/**
 * Format an ISO datetime string or Date object including the time component.
 */
export function formatDateTime(
  date: string | Date | null | undefined,
  options?: { locale?: Locale }
): string {
  return formatDate(date, DATETIME_FORMAT, options)
}

/**
 * Format just the time component down to the millisecond, e.g. "14:03:27.481".
 * Used where sub-second precision matters, such as comparing an event's
 * scheduled vs. actual fire time.
 */
export function formatTimePrecise(
  date: string | Date | null | undefined,
  options?: { locale?: Locale }
): string {
  return formatDate(date, TIME_PRECISE_FORMAT, options)
}

/**
 * Return a relative time string, e.g. "3 hours ago".
 */
export function formatRelative(
  date: string | Date | null | undefined,
  options?: { locale?: Locale; addSuffix?: boolean }
): string {
  if (!date) return ''
  const d = typeof date === 'string' ? parseISO(date) : date
  if (!isValid(d)) return ''
  return formatDistanceToNow(d, { addSuffix: true, ...options })
}

/**
 * Signed firing delay between when an event was scheduled and when it actually
 * fired: `fired - scheduled`. Positive means it fired late (the common case),
 * negative means early. Returns null if either timestamp is missing/invalid so
 * callers can render their own placeholder.
 */
export function delayMs(
  scheduled: string | Date | null | undefined,
  fired: string | Date | null | undefined
): number | null {
  if (!scheduled || !fired) return null
  const s = typeof scheduled === 'string' ? parseISO(scheduled) : scheduled
  const f = typeof fired === 'string' ? parseISO(fired) : fired
  if (!isValid(s) || !isValid(f)) return null
  return f.getTime() - s.getTime()
}

/**
 * Human-readable signed delay, e.g. "+482ms", "+3.21s", "−120ms".
 * Sub-second magnitudes render as milliseconds; larger ones as seconds.
 */
export function formatDelay(
  scheduled: string | Date | null | undefined,
  fired: string | Date | null | undefined
): string {
  const ms = delayMs(scheduled, fired)
  if (ms === null) return '—'
  const sign = ms < 0 ? '−' : '+'
  const abs = Math.abs(ms)
  if (abs < 1000) return `${sign}${Math.round(abs)}ms`
  return `${sign}${(abs / 1000).toFixed(2)}s`
}
