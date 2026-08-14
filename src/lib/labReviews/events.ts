import 'server-only'

import { ROLE, type ProviderAccess } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { namesFor } from './queries'

/**
 * The per-review audit log: what changed, and who changed it.
 *
 * Shaped after `prescription_workflow_events`, which already does this job for
 * prescriptions in the same database — actor id plus a *denormalised* display
 * name and role. The denormalisation is the point: a trail that renders
 * differently after somebody is renamed or loses a role is not a trail. The name
 * recorded here is the name as it was when the action happened.
 *
 * The started and completed timestamps on `lab_reviews` are the same facts as
 * the `started` and `completed` entries here. The columns exist because they are
 * cheap to query for staffing numbers; this table is the readable history.
 */

export const LAB_REVIEW_EVENT_TYPES = [
  'started',
  'assigned',
  'reassigned',
  'draft_saved',
  'disposition_set',
  'completed',
  'needs_attention_requested',
  'cs_action_requested',
  'note_added',
  'labs_ordered',
  'labs_order_cancelled',
  'consultation_requested',
] as const

export type LabReviewEventType = (typeof LAB_REVIEW_EVENT_TYPES)[number]

export type LabReviewEvent = {
  id: string
  createdAt: string | null
  eventType: string
  actorName: string | null
  actorRole: string | null
  summary: string | null
  fromStatus: string | null
  toStatus: string | null
}

/** Who performed an action, captured at the moment it happened. */
export type Actor = {
  userId: string
  displayName: string
  role: string
}

/**
 * `roles` is a set of numeric ids and a person can hold several. Provider is
 * reported ahead of admin because it describes the clinical capacity they are
 * acting in on this screen, which is what the trail should say.
 */
function roleLabel(roles: number[]): string {
  if (roles.includes(ROLE.provider)) return 'provider'
  if (roles.includes(ROLE.admin)) return 'admin'
  return 'staff'
}

export async function resolveActor(access: ProviderAccess): Promise<Actor> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('user_list')
    .select('first_name, last_name')
    .eq('user_id', access.userId)
    .maybeSingle()

  const name = [data?.first_name, data?.last_name].filter(Boolean).join(' ').trim()

  return {
    userId: access.userId,
    // Falling back to the email keeps the trail attributable even for an account
    // with no `user_list` row, which is a real state for a fresh staff account.
    displayName: name || access.email,
    role: roleLabel(access.roles),
  }
}

export type LogResult = { ok: true } | { ok: false; error: string }

/**
 * Append one entry.
 *
 * Called **after** the change it records has already committed. supabase-js
 * offers no cross-statement transaction, so there is no way to make the change
 * and its audit entry atomic from here — and writing the entry first would leave
 * a phantom event behind whenever the change then failed.
 *
 * So a failure here means "the change happened, the trail does not show it".
 * That is returned to the caller rather than swallowed. An audit log with
 * invisible gaps is worse than one that tells you it is incomplete.
 */
export async function logLabReviewEvent(input: {
  labReviewId: string
  eventType: LabReviewEventType
  actor: Actor
  summary: string
  fromStatus?: string | null
  toStatus?: string | null
  metadata?: Record<string, unknown>
}): Promise<LogResult> {
  const admin = createAdminClient()

  const { error } = await admin.from('lab_review_events').insert({
    lab_review_id: input.labReviewId,
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

/**
 * The doc's second note type: notes *about the review*, not about the patient.
 *
 * A handoff reason belongs here rather than in `patient_notes_private`, which is
 * the clinical chart. "Escalating because I want a second opinion on the Hct
 * trend" is about how the work is being handled, and putting it on the chart
 * would mix workflow chatter into the patient's medical record.
 */
export type LabReviewNote = {
  id: string
  createdAt: string | null
  authorName: string | null
  note: string
  kind: string
  aiAssisted: boolean
}

export async function listLabReviewNotes(labReviewId: string): Promise<LabReviewNote[]> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('lab_review_notes')
    .select('id, created_at, created_by, note, kind, ai_assisted')
    .eq('lab_review_id', labReviewId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`lab_review_notes query failed: ${error.message}`)

  const rows = data ?? []
  // Resolved live rather than denormalised, unlike the audit log: these are short
  // lists read next to a name that is expected to be current.
  const names = await namesFor(
    rows.map((r) => r.created_by as string).filter(Boolean),
    'Unknown author'
  )

  return rows.map((r) => ({
    id: String(r.id),
    createdAt: (r.created_at as string | null) ?? null,
    authorName: names.get(r.created_by as string) ?? null,
    note: (r.note as string | null) ?? '',
    kind: (r.kind as string | null) ?? 'handoff',
    aiAssisted: Boolean(r.ai_assisted),
  }))
}

export async function listLabReviewEvents(labReviewId: string): Promise<LabReviewEvent[]> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('lab_review_events')
    .select(
      'id, created_at, event_type, actor_display_name, actor_role, summary, from_status, to_status'
    )
    .eq('lab_review_id', labReviewId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(`lab_review_events query failed: ${error.message}`)

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
