import { shortDate } from '../labReviews/format.ts'
import type { ReviewStanding } from './standing.ts'
import { DOCUMENT_TYPE_LABEL, type ContentReviewDocumentType } from './view.ts'

export const STANDING_LABEL: Record<ReviewStanding, string> = {
  queued: 'Queued',
  in_review: 'In review',
  stale: 'Changed since approval',
  revised: 'Revised',
  changes_requested: 'Changes requested',
  approved: 'Approved',
}

function by(name: string | null, at: string | null): string {
  return [name ? `by ${name}` : null, at ? `(${shortDate(at)})` : null].filter(Boolean).join(' ')
}

/** The row's second line, as segments a caller joins with a separator. */
export function reviewRowMeta(
  row: {
    documentType: ContentReviewDocumentType
    standing: ReviewStanding
    assignedToName: string | null
    startedAt: string | null
    reviewedByName: string | null
    reviewedAt: string | null
    approvedAt: string | null
  }
): string[] {
  const segments = [DOCUMENT_TYPE_LABEL[row.documentType]]
  const approved = `approved ${by(row.reviewedByName, row.approvedAt)}`.trim()
  const requested = `changes requested ${by(row.reviewedByName, row.reviewedAt)}`.trim()

  switch (row.standing) {
    case 'queued':
      segments.push('queued')
      break
    case 'in_review':
      segments.push(row.assignedToName ? `${row.assignedToName} has it` : 'in review')
      break
    case 'stale':
      segments.push(approved, 'page changed since')
      break
    case 'revised':
      segments.push(requested, 'revised since')
      break
    case 'changes_requested':
      segments.push(requested)
      break
    case 'approved':
      segments.push(approved)
      break
  }
  return segments
}
