const DATE_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>()

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = DATE_FORMATTER_CACHE.get(timeZone)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  DATE_FORMATTER_CACHE.set(timeZone, formatter)
  return formatter
}

/** Returns YYYY-MM-DD in the given IANA time zone. */
export function dateKey(timestamp: number, timeZone: string): string {
  try {
    return dateFormatter(timeZone).format(new Date(timestamp))
  } catch {
    return dateFormatter('UTC').format(new Date(timestamp))
  }
}

export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function startOfLocalDay(date: string, timeZone: string): number {
  // Derive the UTC instant for 00:00 of `date` in `timeZone` without a date library.
  const [year, month, day] = date.split('-').map(Number)
  const utcGuess = Date.UTC(year, (month ?? 1) - 1, day ?? 1)
  const offset = timeZoneOffsetMs(utcGuess, timeZone)
  return utcGuess - offset
}

function timeZoneOffsetMs(timestamp: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(timestamp))
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return asUtc - timestamp
}

export function minutesAgo(timestamp: number): number {
  return Math.floor((Date.now() - timestamp) / 60000)
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

export function addDays(timestamp: number, days: number): number {
  return timestamp + days * 86_400_000
}
