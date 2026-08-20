/**
 * A row of the lab-review queue, and what it says about the review's progress.
 *
 * The type lives here rather than beside the query that builds it so that the
 * components rendering a row can name it: `queries.ts` is server-only and
 * fenced off from `src/components` by lint.
 *
 * Pure, so "is this being worked on" can be tested directly.
 */

import { relativeAge, shortDate } from './format.ts'

const SOURCE_LABELS: Record<string, string> = {
  incoming_fax: 'Fax',
  patient_upload: 'Upload',
}

export type QueueRow = {
  id: string
  patientId: string
  patientName: string
  patientEmail: string | null
  /** The review's own `lab_reviews.status`. */
  status: string
  /** The patient's `user_statuses` label — the same one the detail header shows.
   *  It decides which dispositions the review can end in, so it belongs on the
   *  row as much as on the review. */
  patientStatus: string | null
  summaryStatus: string | null
  assignedTo: string | null
  assignedToName: string | null
  /** Set when a provider first opened the review, and never cleared. */
  startedAt: string | null
  /** Last autosave of the draft — how stale the work in progress is. */
  draftUpdatedAt: string | null
  reviewedAt: string | null
  lastSourceAt: string | null
  createdAt: string | null
  sourceKinds: string[]
  flags: string[]
}

export type QueueProgress = 'unclaimed' | 'in_progress' | 'finished'

/**
 * `started_at` is what a provider opening the review sets, and it is never
 * cleared, so a finished review has one too — hence the status check first.
 *
 * A review that is assigned but never started is not called in progress: being
 * handed a review is not the same as having begun it, and the assignee shown on
 * the row already says who holds it.
 */
export function progressOf(
  review: Pick<QueueRow, 'status' | 'startedAt'>
): QueueProgress {
  if (review.status === 'finished') return 'finished'
  return review.startedAt ? 'in_progress' : 'unclaimed'
}

/** "Fax + Upload", or null when a review has no source rows. */
export function sourceLabel(sourceKinds: string[]): string | null {
  if (!sourceKinds.length) return null
  return sourceKinds.map((kind) => SOURCE_LABELS[kind] ?? kind).join(' + ')
}

/**
 * The row's second line, as segments a caller joins with a separator.
 *
 * Order is arrival, then who holds it, then how fresh the work is — oldest fact
 * to newest, which is also least to most useful when deciding what to pick up.
 * `now` is injectable so this is testable without freezing the clock.
 */
export function queueRowMeta(
  review: Pick<
    QueueRow,
    | 'status'
    | 'assignedToName'
    | 'startedAt'
    | 'draftUpdatedAt'
    | 'reviewedAt'
    | 'lastSourceAt'
    | 'createdAt'
    | 'sourceKinds'
  >,
  now: Date = new Date()
): string[] {
  const arrivedAt = review.lastSourceAt ?? review.createdAt
  const age = relativeAge(arrivedAt, now)

  const segments = [
    sourceLabel(review.sourceKinds),
    arrivedAt ? `arrived ${age ? `${age} ` : ''}(${shortDate(arrivedAt)})` : null,
  ]

  const progress = progressOf(review)

  if (progress === 'finished') {
    segments.push(review.reviewedAt ? `finished ${relativeAge(review.reviewedAt, now)}` : 'finished')
    return segments.filter(Boolean) as string[]
  }

  segments.push(
    review.assignedToName ? `assigned to ${review.assignedToName}` : 'unclaimed',
    // The draft is autosaved, so its timestamp is the honest answer to "has
    // anyone actually written anything". Falling back to the start says the
    // review was opened and nothing was typed.
    progress === 'in_progress'
      ? review.draftUpdatedAt
        ? `edited ${relativeAge(review.draftUpdatedAt, now)}`
        : `started ${relativeAge(review.startedAt, now)}`
      : null
  )

  return segments.filter(Boolean) as string[]
}
