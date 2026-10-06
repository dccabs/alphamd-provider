import 'server-only'

import type { ProviderAccess } from '@/lib/authz'
import { resolveActor } from '@/lib/labReviews/events'
import { createAdminClient } from '@/lib/supabase/admin'
import { logProviderQuestionEvent } from './events'
import { isProviderQuestionStatus, type ProviderQuestionStatus } from './queueRow'
import { planTake } from './take'

/**
 * Writes to a Provider Question from the pile. Same three rules as
 * `labReviews/mutations`: the caller has already proven access, the row is
 * re-read before it is changed, and nothing changes without an audit entry.
 */

export type MutationResult = { ok: true; warning?: string } | { ok: false; error: string }

type GuardRow = {
  id: string
  patientId: string
  status: ProviderQuestionStatus
  assignedTo: string | null
  urgent: boolean
}

export async function loadForMutation(id: string): Promise<GuardRow | null> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('provider_questions')
    .select('id, patient_id, status, assigned_to, urgent')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`provider_questions lookup failed: ${error.message}`)
  if (!data) return null

  const status = data.status as string
  return {
    id: data.id as string,
    patientId: data.patient_id as string,
    status: isProviderQuestionStatus(status) ? status : 'queued',
    assignedTo: (data.assigned_to as string | null) ?? null,
    urgent: Boolean(data.urgent),
  }
}

async function recorded(
  entry: Parameters<typeof logProviderQuestionEvent>[0]
): Promise<MutationResult> {
  const logged = await logProviderQuestionEvent(entry)
  if (!logged.ok) {
    return {
      ok: true,
      warning: `Saved, but the audit log entry failed (${logged.error}). Tell an administrator — this change is not in the question's history.`,
    }
  }
  return { ok: true }
}

async function nameOf(userId: string): Promise<string> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('user_list')
    .select('first_name, last_name')
    .eq('user_id', userId)
    .maybeSingle()

  return [data?.first_name, data?.last_name].filter(Boolean).join(' ').trim() || 'another provider'
}

/**
 * Take-to-self. Queued → in progress with me; someone else's in-progress →
 * mine, still in progress. `started_at` is stamped on the first take only.
 *
 * Compare-and-swap on the assignment just read, as in `startLabReview`: two
 * providers can click the same row, and the second click must see a message
 * rather than silently win.
 */
export async function takeProviderQuestion(
  access: ProviderAccess,
  id: string
): Promise<MutationResult> {
  const row = await loadForMutation(id)
  if (!row) return { ok: false, error: 'This Provider Question no longer exists.' }

  const plan = planTake(row, access.userId)
  if (plan.kind === 'refuse') return { ok: false, error: plan.error }
  if (plan.kind === 'already-mine') return { ok: true }

  const admin = createAdminClient()
  const actor = await resolveActor(access)
  const now = new Date().toISOString()

  const update = admin
    .from('provider_questions')
    .update({
      assigned_to: access.userId,
      status: plan.toStatus,
      updated_at: now,
      ...(row.status === 'queued' ? { started_at: now } : {}),
    })
    .eq('id', id)
    .neq('status', 'finished')

  const { data: updated, error } = await (plan.from === null
    ? update.is('assigned_to', null)
    : update.eq('assigned_to', plan.from)
  ).select('id')
  if (error) return { ok: false, error: `Could not take this question: ${error.message}` }

  if (!updated?.length) {
    return {
      ok: false,
      error: 'Another provider took this question a moment ago. Reload the page.',
    }
  }

  const fromName = plan.from ? await nameOf(plan.from) : null
  return recorded({
    providerQuestionId: id,
    eventType: 'taken',
    actor,
    summary: fromName
      ? `${actor.displayName} took the Provider Question from ${fromName}`
      : `${actor.displayName} took the Provider Question`,
    fromStatus: row.status,
    toStatus: plan.toStatus,
    metadata: { from: plan.from, to: access.userId },
  })
}

/** Urgent on or off. Any Working Provider may flip it; finish clears it. */
export async function setProviderQuestionUrgent(
  access: ProviderAccess,
  id: string,
  urgent: boolean
): Promise<MutationResult> {
  const row = await loadForMutation(id)
  if (!row) return { ok: false, error: 'This Provider Question no longer exists.' }
  if (row.status === 'finished') {
    return { ok: false, error: 'This Provider Question is already finished.' }
  }
  if (row.urgent === urgent) return { ok: true }

  const admin = createAdminClient()
  const actor = await resolveActor(access)

  const { data: updated, error } = await admin
    .from('provider_questions')
    .update({ urgent, updated_at: new Date().toISOString() })
    .eq('id', id)
    .neq('status', 'finished')
    .select('id')
  if (error) return { ok: false, error: `Could not update Urgent: ${error.message}` }
  if (!updated?.length) return { ok: false, error: 'This Provider Question was just finished.' }

  return recorded({
    providerQuestionId: id,
    eventType: urgent ? 'urgent_set' : 'urgent_cleared',
    actor,
    summary: urgent
      ? `${actor.displayName} marked the Provider Question Urgent`
      : `${actor.displayName} cleared Urgent on the Provider Question`,
    fromStatus: row.status,
    toStatus: row.status,
  })
}
