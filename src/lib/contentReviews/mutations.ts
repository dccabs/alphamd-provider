import 'server-only'

import type { ContentReviewerAccess } from '@/lib/authz'
import { resolveActor } from '@/lib/labReviews/events'
import { createAdminClient } from '@/lib/supabase/admin'
import { planDecision, type Decision } from './decision'
import { logContentReviewEvent } from './events'
import { loadLatestForDocument, loadReview } from './queries'
import { fetchCurrentRev } from './sanity'
import { isContentReviewStatus, reviewStanding, type ContentReviewStatus } from './standing'
import { planTake } from './take'

/**
 * Writes to the Content Review queue. Same rules as `providerQuestions/mutations`:
 * access is proven by the caller, the row is re-read before it changes, writes
 * compare-and-swap on what was read, and every change gets an audit entry.
 * Nothing here writes to Sanity.
 */

export type MutationResult =
  | { ok: true; warning?: string; reviewId: string }
  | { ok: false; error: string }

const UNIQUE_VIOLATION = '23505'

function statusOf(value: string): ContentReviewStatus {
  return isContentReviewStatus(value) ? value : 'queued'
}

async function recorded(
  reviewId: string,
  entry: Omit<Parameters<typeof logContentReviewEvent>[0], 'contentReviewId'>
): Promise<MutationResult> {
  const logged = await logContentReviewEvent({ contentReviewId: reviewId, ...entry })
  if (!logged.ok) {
    return {
      ok: true,
      reviewId,
      warning: `Saved, but the audit log entry failed (${logged.error}). Tell an administrator — this change is not in the review's history.`,
    }
  }
  return { ok: true, reviewId }
}

/**
 * Take-to-self. A queued or in-review row is claimed in place. A decided row
 * whose page has since changed is left as history and a new review is opened
 * on the same document, which the caller should navigate to.
 */
export async function takeContentReview(
  access: ContentReviewerAccess,
  id: string
): Promise<MutationResult> {
  const row = await loadReview(id)
  if (!row) return { ok: false, error: 'This Content Review no longer exists.' }

  const latest = await loadLatestForDocument(row.sanity_document_id)
  if (latest && latest.id !== id) {
    return { ok: false, error: 'A newer review of this page exists. Open it from the queue.' }
  }

  const status = statusOf(row.status)
  const currentRev = await fetchCurrentRev(row.sanity_document_id)
  if (currentRev === undefined) {
    return { ok: false, error: 'Could not check the published version with Sanity. Try again in a moment.' }
  }

  const standing = reviewStanding({ status, reviewedRev: row.reviewed_rev }, currentRev)
  const plan = planTake({ standing, assignedTo: row.assigned_to }, access.userId)
  if (plan.kind === 'refuse') return { ok: false, error: plan.error }
  if (plan.kind === 'already-mine') return { ok: true, reviewId: id }

  const admin = createAdminClient()
  const actor = await resolveActor(access)
  const now = new Date().toISOString()

  if (plan.kind === 'reopen') {
    const { data: inserted, error } = await admin
      .from('content_reviews')
      .insert({
        sanity_document_id: row.sanity_document_id,
        document_type: row.document_type,
        slug: row.slug,
        title: row.title,
        status: 'in_review',
        priority: row.priority,
        source: 'rereview',
        flags: row.flags ?? [],
        assigned_to: access.userId,
        previous_review_id: row.id,
        started_at: now,
      })
      .select('id')
      .single()
    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        return { ok: false, error: 'Another reviewer reopened this page a moment ago. Reload the queue.' }
      }
      return { ok: false, error: `Could not reopen this review: ${error.message}` }
    }

    const newId = inserted.id as string
    return recorded(newId, {
      eventType: 'taken',
      actor,
      summary:
        standing === 'stale'
          ? `${actor.displayName} reopened the review: the page changed after approval`
          : `${actor.displayName} reopened the review: the editor published a revision`,
      fromStatus: null,
      toStatus: 'in_review',
      metadata: { previous_review_id: row.id, previous_rev: row.reviewed_rev, rev: currentRev },
    })
  }

  const update = admin
    .from('content_reviews')
    .update({
      status: 'in_review',
      assigned_to: access.userId,
      updated_at: now,
      ...(status === 'queued' ? { started_at: now } : {}),
    })
    .eq('id', id)
    .eq('status', status)

  const { data: updated, error } = await (plan.from === null
    ? update.is('assigned_to', null)
    : update.eq('assigned_to', plan.from)
  ).select('id')
  if (error) return { ok: false, error: `Could not take this review: ${error.message}` }
  if (!updated?.length) {
    return { ok: false, error: 'Another reviewer took this review a moment ago. Reload the page.' }
  }

  return recorded(id, {
    eventType: 'taken',
    actor,
    summary: plan.from
      ? `${actor.displayName} took over the review`
      : `${actor.displayName} took the review`,
    fromStatus: status,
    toStatus: 'in_review',
    metadata: { from: plan.from, to: access.userId, rev: currentRev },
  })
}

/**
 * Approve or Request changes. Recorded against `shownRev`, the version the
 * reviewer's screen rendered, and only if Sanity still publishes it.
 */
export async function decideContentReview(
  access: ContentReviewerAccess,
  id: string,
  input: { decision: Decision; shownRev: string; comment?: string | null }
): Promise<MutationResult> {
  const row = await loadReview(id)
  if (!row) return { ok: false, error: 'This Content Review no longer exists.' }

  const currentRev = await fetchCurrentRev(row.sanity_document_id)
  const plan = planDecision({
    row: { status: statusOf(row.status), assignedTo: row.assigned_to },
    viewerId: access.userId,
    shownRev: input.shownRev,
    currentRev,
    decision: input.decision,
    comment: input.comment,
  })
  if (!plan.ok) return { ok: false, error: plan.error }

  const admin = createAdminClient()
  const actor = await resolveActor(access)
  const now = new Date().toISOString()

  const { data: updated, error } = await admin
    .from('content_reviews')
    .update({
      status: plan.toStatus,
      reviewed_rev: plan.reviewedRev,
      reviewed_by: access.userId,
      reviewed_at: now,
      reviewer_comments: plan.comment,
      approved_at: plan.toStatus === 'approved' ? now : null,
      updated_at: now,
    })
    .eq('id', id)
    .eq('status', 'in_review')
    .eq('assigned_to', access.userId)
    .select('id')
  if (error) return { ok: false, error: `Could not save the decision: ${error.message}` }
  if (!updated?.length) {
    return { ok: false, error: 'This review changed a moment ago. Reload the page.' }
  }

  return recorded(id, {
    eventType: plan.toStatus,
    actor,
    summary:
      plan.toStatus === 'approved'
        ? `${actor.displayName} approved the page`
        : `${actor.displayName} requested changes`,
    fromStatus: 'in_review',
    toStatus: plan.toStatus,
    metadata: { rev: plan.reviewedRev, bio_slug: access.bioSlug, comment: plan.comment },
  })
}
