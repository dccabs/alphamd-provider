/**
 * Calendar-day helpers for the dashboard's consultation card. Pure, so they run
 * in the browser (where "today" and clock times are the provider's) and in
 * tests, matching `labReviews/consultations.ts`.
 *
 * The server does not know the provider's timezone. So the server reads a
 * window wide enough to hold the requested calendar day anywhere on Earth
 * (`dayWindow`), and the client keeps the rows that fall on that day locally
 * (`onLocalDay`). A day key is `YYYY-MM-DD` and always means a *local* day.
 */

const HOUR = 60 * 60 * 1000
const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DD` as typed into `?day=`. Anything else means "today". */
export function parseDayKey(value: string | undefined | null): string | null {
  if (!value) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

/** Local calendar day of a Date. */
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function shiftDayKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  return localDayKey(new Date(y, m - 1, d + days))
}

/**
 * The read window for a day key. Timezones run from UTC-12 to UTC+14, so ±14h
 * around the UTC day covers every local reading of it. With no key, ±36h
 * around now covers "today" wherever the browser is.
 */
export function dayWindow(
  dayKey: string | null,
  now: Date = new Date()
): { from: string; to: string } {
  if (dayKey) {
    const [y, m, d] = dayKey.split('-').map(Number)
    const start = Date.UTC(y, m - 1, d)
    const end = Date.UTC(y, m - 1, d + 1)
    return {
      from: new Date(start - 14 * HOUR).toISOString(),
      to: new Date(end + 14 * HOUR).toISOString(),
    }
  }
  return {
    from: new Date(now.getTime() - 36 * HOUR).toISOString(),
    to: new Date(now.getTime() + 36 * HOUR).toISOString(),
  }
}

/** The rows that start on `dayKey` in the local timezone, earliest first. */
export function onLocalDay<T extends { startsAt: string }>(rows: T[], dayKey: string): T[] {
  return rows
    .filter((r) => localDayKey(new Date(r.startsAt)) === dayKey)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}

export function formatClock(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso)
  )
}

/** "Today", "Tomorrow", then "Thu, Sep 24". */
export function formatDayHeading(dayKey: string, todayKey: string): string {
  if (dayKey === todayKey) return 'Today'
  if (dayKey === shiftDayKey(todayKey, 1)) return 'Tomorrow'
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(y, m - 1, d))
}

/** Calendly event names are "AlphaMD Provider, Secondary Follow-Up"; the part
 *  after the comma is the consultation type a provider cares about. */
export function consultationType(name: string | null): string {
  const trimmed = name?.trim()
  if (!trimmed) return 'Consultation'
  const comma = trimmed.indexOf(',')
  return comma >= 0 ? trimmed.slice(comma + 1).trim() || trimmed : trimmed
}

export function durationMinutes(startIso: string, endIso: string | null): number | null {
  if (!endIso) return null
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 60_000) : null
}
