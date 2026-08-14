/**
 * Past consultations — outcome derivation. Pure, so it is safe in client
 * components and can be unit-tested, matching `notes.ts` and `orders.ts`.
 *
 * **`user_consultation_schedules.event_status` is a Calendly invitee state, not
 * a "has this happened yet" flag**, and reading it as one is the trap here.
 * Measured on production across all 3,606 rows:
 *
 *  - `active` is 3,240 rows, and 3,179 of those are already in the past. It
 *    means "not cancelled", nothing more. Treating it as "upcoming" would put
 *    years of history under a Scheduled heading.
 *  - `no-show` is 363 rows and is the only outcome anyone actually maintains.
 *  - `complete` and `completed` together are **3 rows**. So the absence of them
 *    says nothing about attendance, which is why a past appointment that was
 *    not marked no-show reads as `unrecorded` rather than attended. Claiming a
 *    consultation was attended on that evidence would be a guess printed on a
 *    clinical screen.
 *  - `consultation_type` is null on all 3,606 rows — do not display it.
 *
 * So past versus upcoming comes from `event_start_time` against the clock, and
 * the status column is consulted only for no-shows and cancellations.
 */

export type ConsultationOutcome =
  | 'scheduled'
  | 'attended'
  | 'no_show'
  | 'cancelled'
  | 'unrecorded'

export type Consultation = {
  id: string
  startsAt: string | null
  endsAt: string | null
  /** e.g. "AlphaMD Provider, Secondary Follow-Up". Null on 165 of 3,606 rows. */
  name: string | null
  /** Resolved from `medical_provider` through `user_list`. Every non-null id in
   *  production resolves, but the column itself is null on 65 rows. */
  providerName: string | null
  timezone: string | null
  outcome: ConsultationOutcome
}

/** Calendly has spelled cancellation both ways across API versions, and the
 *  webhook stores whatever it was sent. Neither spelling is present in
 *  production today; both are accepted so a future one is not read as a past
 *  appointment that quietly happened. */
const CANCELLED = new Set(['cancelled', 'canceled'])
const NO_SHOW = new Set(['no-show', 'no_show', 'noshow'])
const ATTENDED = new Set(['complete', 'completed'])

export function consultationOutcome(
  eventStatus: string | null | undefined,
  startsAt: string | null | undefined,
  now: Date = new Date()
): ConsultationOutcome {
  const status = eventStatus?.trim().toLowerCase() ?? ''

  if (CANCELLED.has(status)) return 'cancelled'
  if (NO_SHOW.has(status)) return 'no_show'
  if (ATTENDED.has(status)) return 'attended'

  const start = startsAt ? new Date(startsAt) : null
  if (!start || Number.isNaN(start.getTime())) return 'unrecorded'

  return start > now ? 'scheduled' : 'unrecorded'
}

export const CONSULTATION_OUTCOME_LABELS: Record<ConsultationOutcome, string> = {
  scheduled: 'Upcoming',
  attended: 'Attended',
  no_show: 'No-show',
  cancelled: 'Cancelled',
  unrecorded: 'Past',
}

/** Count of consultations still ahead of the patient — what the tab badges. */
export function upcomingCount(consultations: Consultation[]): number {
  return consultations.filter((c) => c.outcome === 'scheduled').length
}

/** Start time as a number, or null when there is nothing parseable to compare. */
function startedAt(consultation: Consultation): number | null {
  if (!consultation.startsAt) return null
  const time = new Date(consultation.startsAt).getTime()
  return Number.isNaN(time) ? null : time
}

function pickByTime(
  consultations: Consultation[],
  direction: 'earliest' | 'latest'
): Consultation | null {
  let best: Consultation | null = null
  let bestTime: number | null = null

  for (const consultation of consultations) {
    const time = startedAt(consultation)
    if (time === null) continue

    const better = bestTime === null || (direction === 'earliest' ? time < bestTime : time > bestTime)
    if (better) {
      best = consultation
      bestTime = time
    }
  }

  return best
}

/**
 * The one consultation worth showing in the patient header.
 *
 * A booking that has not happened yet outranks all of history, because it
 * changes what the provider should do with these labs. The *soonest* one wins
 * rather than the furthest out — that is the one about to happen. With nothing
 * booked, the most recent appointment is the useful context instead.
 *
 * Order is derived from `startsAt` rather than assumed from the array, so a
 * caller that sorted the list differently still gets the same answer. A row with
 * no usable date can only be chosen when there is nothing else at all.
 */
export function featuredConsultation(consultations: Consultation[]): Consultation | null {
  if (!consultations.length) return null

  const upcoming = consultations.filter((c) => c.outcome === 'scheduled')

  return pickByTime(upcoming, 'earliest') ?? pickByTime(consultations, 'latest') ?? consultations[0]
}
