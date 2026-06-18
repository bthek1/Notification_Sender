import {
  format,
  formatDistanceToNow,
  parseISO,
  isValid,
  type Locale,
} from 'date-fns'

const DEFAULT_FORMAT = 'dd MMM yyyy'
const DATETIME_FORMAT = 'dd MMM yyyy, HH:mm'

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
