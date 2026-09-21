import 'server-only'

import type { Actor } from '@/lib/labReviews/events'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The per-question audit log. Same shape and same rules as `lab_review_events`
 * (see `labReviews/events.ts`): denormalised actor name and role, appended
 * *after* the change it records, and a failure to append is reported to the
 * caller rather than swallowed.
 */

export const PROVIDER_QUESTION_EVENT_TYPES = [
  'created',
  'taken',
  'urgent_set',
  'urgent_cleared',
  'finished',
  // Shared with Lab Reviews — the toolkit logs through `workSubject.ts`.
  'labs_ordered',
  'labs_order_cancelled',
  'consultation_requested',
  'cs_action_requested',
  'note_added',
] as const

export type ProviderQuestionEventType = (typeof PROVIDER_QUESTION_EVENT_TYPES)[number]

export type ProviderQuestionEvent = {
  id: string
  createdAt: string | null
  eventType: string
  actorName: string | null
  actorRole: string | null
  summary: string | null
  fromStatus: string | null
  toStatus: string | null
}

export type LogResult = { ok: true } | { ok: false; error: string }

export async function logProviderQuestionEvent(input: {
  providerQuestionId: string
  eventType: ProviderQuestionEventType
  actor: Actor
  summary: string
  fromStatus?: string | null
  toStatus?: string | null
  metadata?: Record<string, unknown>
}): Promise<LogResult> {
  const admin = createAdminClient()

  const { error } = await admin.from('provider_question_events').insert({
    provider_question_id: input.providerQuestionId,
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

export async function listProviderQuestionEvents(
  providerQuestionId: string
): Promise<ProviderQuestionEvent[]> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('provider_question_events')
    .select(
      'id, created_at, event_type, actor_display_name, actor_role, summary, from_status, to_status'
    )
    .eq('provider_question_id', providerQuestionId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(`provider_question_events query failed: ${error.message}`)

  return (data ?? []).map((r) => ({
    id: String(r.id),
    createdAt: (r.created_at as string | null) ?? null,
    eventType: r.event_type as string,
    actorName: (r.actor_display_name as string | null) ?? null,
    actorRole: (r.actor_role as string | null) ?? null,
    summary: (r.summary as string | null) ?? null,
    fromStatus: (r.from_status as string | null) ?? null,
    toStatus: (r.to_status as string | null) ?? null,
  }))
}
