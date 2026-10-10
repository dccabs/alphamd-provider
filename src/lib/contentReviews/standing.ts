/**
 * Where a Content Review stands against the page as it is published now.
 *
 * A review is of one Sanity `_rev`. The stored status says what the reviewer
 * decided; the live `_rev` says whether that decision still describes the page.
 * The stored status never turns stale on its own: anything else reading
 * `content_reviews` must compare `reviewed_rev` to the published `_rev` the way
 * `isApprovalCurrent` does.
 */

export const CONTENT_REVIEW_STATUSES = [
  'queued',
  'in_review',
  'changes_requested',
  'approved',
] as const
export type ContentReviewStatus = (typeof CONTENT_REVIEW_STATUSES)[number]

export function isContentReviewStatus(value: string | undefined): value is ContentReviewStatus {
  return !!value && (CONTENT_REVIEW_STATUSES as readonly string[]).includes(value)
}

/**
 * - `stale`: approved, but the page has been published again since.
 * - `revised`: changes requested, and the editor has published a new revision.
 */
export type ReviewStanding = ContentReviewStatus | 'stale' | 'revised'

/**
 * `currentRev` is the published `_rev`: `null` when the document is not
 * published, `undefined` when Sanity could not be asked. Neither is proof the
 * page changed, so both leave a decided review where it was.
 */
export function reviewStanding(
  row: { status: ContentReviewStatus; reviewedRev: string | null },
  currentRev: string | null | undefined
): ReviewStanding {
  const changed = typeof currentRev === 'string' && currentRev !== row.reviewedRev
  if (row.status === 'approved') return changed ? 'stale' : 'approved'
  if (row.status === 'changes_requested') return changed ? 'revised' : 'changes_requested'
  return row.status
}

/** The queue: everything a reviewer could pick up now. */
export function isInQueue(standing: ReviewStanding): boolean {
  return (
    standing === 'queued' ||
    standing === 'in_review' ||
    standing === 'stale' ||
    standing === 'revised'
  )
}

/** Approved, for exactly the version that is published. */
export function isApprovalCurrent(
  row: { status: ContentReviewStatus; reviewedRev: string | null },
  currentRev: string | null | undefined
): boolean {
  return row.status === 'approved' && typeof currentRev === 'string' && row.reviewedRev === currentRev
}
