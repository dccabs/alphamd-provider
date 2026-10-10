import type { ReviewStanding } from './standing.ts'

/**
 * Take-to-self, as in `providerQuestions/take`: any content reviewer may claim
 * a queued review or take over someone else's. A decided review is history and
 * is never edited; once the page changes, taking it opens a new review row.
 */
export type TakePlan =
  | { kind: 'claim'; from: string | null }
  | { kind: 'reopen' }
  | { kind: 'already-mine' }
  | { kind: 'refuse'; error: string }

export function planTake(
  row: { standing: ReviewStanding; assignedTo: string | null },
  viewerId: string
): TakePlan {
  switch (row.standing) {
    case 'queued':
      return { kind: 'claim', from: null }
    case 'in_review':
      return row.assignedTo === viewerId
        ? { kind: 'already-mine' }
        : { kind: 'claim', from: row.assignedTo }
    case 'stale':
    case 'revised':
      return { kind: 'reopen' }
    case 'approved':
      return { kind: 'refuse', error: 'This page is already approved as published.' }
    case 'changes_requested':
      return {
        kind: 'refuse',
        error: 'Changes were requested on this version. It returns to the queue when the editor publishes a revision.',
      }
  }
}
