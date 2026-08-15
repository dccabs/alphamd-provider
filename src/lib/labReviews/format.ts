/**
 * Date formatting shared by the queue and detail screens. Pure, so it is safe
 * in both server and client components — and so it can be unit-tested.
 *
 * Everything is rendered in UTC deliberately. These screens are read by staff
 * in several timezones next to timestamps quoted in tickets and faxes; a date
 * that shifts by a day depending on who is looking is worse than one that is
 * consistently UTC.
 */

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** `08/05/26` — the format the design uses throughout. */
export function shortDate(value: string | null | undefined): string {
  const date = toDate(value)
  if (!date) return '—'
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const yy = String(date.getUTCFullYear()).slice(-2)
  return `${mm}/${dd}/${yy}`
}

/** `08/05/26 09:14` for message timestamps. */
export function shortDateTime(value: string | null | undefined): string {
  const date = toDate(value)
  if (!date) return '—'
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const min = String(date.getUTCMinutes()).padStart(2, '0')
  return `${shortDate(value)} ${hh}:${min}`
}

/** `09:14` — for a timestamp from the current session, where the date would only
 *  be noise. Still UTC, like everything else here. */
export function shortTime(value: string | null | undefined): string {
  const date = toDate(value)
  if (!date) return '—'
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const min = String(date.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${min}`
}

/**
 * `3h ago` / `2d ago`. `now` is injectable so this is testable without
 * freezing the clock.
 */
export function relativeAge(
  value: string | null | undefined,
  now: Date = new Date()
): string {
  const date = toDate(value)
  if (!date) return ''

  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)
  if (seconds < 0) return 'just now'
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`

  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`

  return `${Math.floor(months / 12)}y ago`
}

/**
 * The design's status pill is green with a green dot, captioned "Active".
 * `user_statuses` is not a binary though, and half the patients in the live
 * queue are not active: of the 12 reviews currently queued, 6 are
 * "Patient, Active Subscription" and 6 are "Non-Patient - …" (pricing sent,
 * results sent to provider, ready to order, attended consultation).
 *
 * Painting "Non-Patient - Pricing sent to PT" green with an Active-looking dot
 * would tell a provider the opposite of the truth. Only a status that actually
 * says "Active" gets the active treatment — which correctly excludes
 * "Patient,  Subscription Cancelled" as well as every "Non-Patient" status.
 */
export function statusTone(status: string | null | undefined): 'active' | 'neutral' {
  if (!status) return 'neutral'
  return /\bactive\b/i.test(status) ? 'active' : 'neutral'
}

/**
 * A `user_statuses` label shortened for a queue row.
 *
 * The detail header has room for the stored label; a row beside a patient name
 * does not — "Non-Patient, Attended Initial Consultation (ordered a test)" is
 * twice the length of the name it sits next to. This leads with the distinction
 * that actually decides what a provider can do with the review (an existing
 * patient, or a prospect whose dispositions differ), keeps the rest, and drops
 * the parenthetical. Callers should still put the stored label in a `title`.
 *
 * A label that is neither, such as "Alpha MD employee", is passed through rather
 * than forced into one of the two groups.
 */
export function shortStatus(status: string | null | undefined): string | null {
  if (!status?.trim()) return null

  const clean = status.replace(/\s+/g, ' ').trim().replace(/\s*\([^)]*\)/g, '')
  const group = /^non-?patient/i.test(clean)
    ? 'Non-patient'
    : /^patient/i.test(clean)
      ? 'Patient'
      : null
  if (!group) return clean

  const tail = clean
    .replace(/^non-?patient\s*[-,]?\s*/i, '')
    .replace(/^patient\s*[-,]?\s*/i, '')
    .trim()
  return tail ? `${group} · ${tail}` : group
}

/** Initials for an avatar, e.g. "Jonathan Meyer" → "JM". */
export function initials(name: string | null | undefined): string {
  if (!name?.trim()) return '?'
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase() || '?'
}
