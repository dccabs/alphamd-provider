import 'server-only'

import type { Actor } from '@/lib/labReviews/events'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The per-review audit log, same shape and rules as `provider_question_events`:
 * denormalised actor, appended after the change it records, and a failed append
 * reported to the caller. Every decision's metadata carries the Sanity `_rev`.
 */

export const CONTENT_REVIEW_EVENT_TYPES = ['queued', 'taken', 'approved', 'changes_requested'] as const
export type ContentReviewEventType = (typeof CONTENT_REVIEW_EVENT_TYPES)[number]

export type ContentReviewEvent = {
  id: string
  contentReviewId: string
  createdAt: string | null
  eventType: string
  actorName: string | null
  summary: string | null
  rev: string | null
}

export type LogResult = { ok: true } | { ok: false; error: string }

export async function logContentReviewEvent(input: {
  contentReviewId: string
  eventType: ContentReviewEventType
  actor: Actor
  summary: string
  fromStatus?: string | null
  toStatus?: string | null
  metadata?: Record<string, unknown>
}): Promise<LogResult> {
  const { error } = await createAdminClient().from('content_review_events').insert({
    content_review_id: input.contentReviewId,
    event_type: input.eventType,
    actor_user_id: input.actor.userId,
    actor_display_name: input.actor.displayName,
    actor_role: input.actor.role,
    summary: input.summary,
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus ?? null,
    metadata: input.metadata ?? {},
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Events across every review of one document, newest first. */
export async function listContentReviewEvents(reviewIds: string[]): Promise<ContentReviewEvent[]> {
  if (!reviewIds.length) return []
  const { data, error } = await createAdminClient()
    .from('content_review_events')
    .select('id, content_review_id, created_at, event_type, actor_display_name, summary, metadata')
    .in('content_review_id', reviewIds)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(`content_review_events query failed: ${error.message}`)

  return (data ?? []).map((r) => {
    const rev = (r.metadata as { rev?: unknown } | null)?.rev
    return {
      id: String(r.id),
      contentReviewId: r.content_review_id as string,
      createdAt: (r.created_at as string | null) ?? null,
      eventType: r.event_type as string,
      actorName: (r.actor_display_name as string | null) ?? null,
      summary: (r.summary as string | null) ?? null,
      rev: typeof rev === 'string' ? rev : null,
    }
  })
}
