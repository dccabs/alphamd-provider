import type { ContentReviewStatus } from './standing.ts'

export type Decision = 'approve' | 'request_changes'

export type DecisionPlan =
  | {
      ok: true
      toStatus: 'approved' | 'changes_requested'
      reviewedRev: string
      comment: string | null
    }
  | { ok: false; error: string }

/**
 * Approve or Request changes, decided as a pure function.
 *
 * `shownRev` is the `_rev` the reviewer's screen rendered; `currentRev` is the
 * one Sanity publishes at the moment of the click. A decision is recorded
 * against the version the reviewer actually read, so the two must match.
 */
export function planDecision(input: {
  row: { status: ContentReviewStatus; assignedTo: string | null }
  viewerId: string
  shownRev: string
  currentRev: string | null | undefined
  decision: Decision
  comment?: string | null
}): DecisionPlan {
  const { row, viewerId, shownRev, currentRev, decision } = input
  const comment = input.comment?.trim() || null

  if (row.status === 'approved' || row.status === 'changes_requested') {
    return { ok: false, error: 'This review is already decided. Reload the page.' }
  }
  if (row.status !== 'in_review') {
    return { ok: false, error: 'Take this review before deciding it.' }
  }
  if (row.assignedTo !== viewerId) {
    return { ok: false, error: 'Another reviewer has this review. Take it over first.' }
  }
  if (currentRev === undefined) {
    return {
      ok: false,
      error: 'Could not confirm the published version with Sanity. Try again in a moment.',
    }
  }
  if (currentRev === null) {
    return { ok: false, error: 'This page is not published in Sanity any more.' }
  }
  if (currentRev !== shownRev) {
    return {
      ok: false,
      error: 'The page changed in Sanity while you were reading. Reload to review the current version.',
    }
  }
  if (decision === 'request_changes' && !comment) {
    return { ok: false, error: 'Say what needs to change. The editor works from your comment.' }
  }

  return {
    ok: true,
    toStatus: decision === 'approve' ? 'approved' : 'changes_requested',
    reviewedRev: currentRev,
    comment,
  }
}
