'use server'

import { revalidatePath } from 'next/cache'

import { checkContentReviewerAccess } from '@/lib/authz'
import { decideContentReview, takeContentReview } from '@/lib/contentReviews/mutations'

/**
 * Server actions for the Content Review queue. Each re-checks access: a server
 * action is a public HTTP endpoint. A denial is returned, not thrown.
 */

export type ReviewWriteState =
  | { status: 'ok'; reviewId: string; warning?: string }
  | { status: 'error'; message: string }

const DENIED = 'Your session has expired, or your account is not a content reviewer. Reload the page.'

function revalidateReview(...ids: string[]) {
  for (const id of ids) revalidatePath(`/content-reviews/${id}`)
  revalidatePath('/content-reviews')
  revalidatePath('/')
}

/** Take-to-self. A changed page opens a new review; `reviewId` is where to go. */
export async function takeContentReviewAction(id: string): Promise<ReviewWriteState> {
  const access = await checkContentReviewerAccess()
  if (!access.ok) return { status: 'error', message: DENIED }

  const result = await takeContentReview(access.access, id)
  if (!result.ok) return { status: 'error', message: result.error }

  revalidateReview(id, result.reviewId)
  return { status: 'ok', reviewId: result.reviewId, warning: result.warning }
}

export async function decideContentReviewAction(
  id: string,
  decision: 'approve' | 'request_changes',
  shownRev: string,
  comment: string
): Promise<ReviewWriteState> {
  const access = await checkContentReviewerAccess()
  if (!access.ok) return { status: 'error', message: DENIED }
  if (decision !== 'approve' && decision !== 'request_changes') {
    return { status: 'error', message: 'Unknown decision.' }
  }

  const result = await decideContentReview(access.access, id, {
    decision,
    shownRev: String(shownRev ?? ''),
    comment: typeof comment === 'string' ? comment : null,
  })
  if (!result.ok) return { status: 'error', message: result.error }

  revalidateReview(id)
  return { status: 'ok', reviewId: result.reviewId, warning: result.warning }
}
