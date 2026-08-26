import 'server-only'

import type { ProviderAccess } from '@/lib/authz'
import { addPatientFlag } from '@/lib/patients/flags'
import { planProtocolFor } from '@/lib/protocols/mutations'
import { protocolOutcome } from '@/lib/protocols/protocolPlan'
import { createAdminClient } from '@/lib/supabase/admin'

import { FLAG } from './clinicalIds'
import { draftPricing } from './discountSeed'
import { planCompletion, reviewAudiences } from './completion'
import { planCsAction } from './csAction'
import { logLabReviewEvent, resolveActor } from './events'
import { DISPOSITION_LABELS, type ReviewDraft } from './reviewDraft'

/**
 * Review-outcome flags. Replaced as a set when a review is approved, so a
 * stale "Labs reviewed, no changes" cannot sit next to a new "Follow Up
 * Required". Protocol-sent pricing (flag 5) is not in this set — that flag is
 * owned by `sendProtocol`.
 */
const REVIEW_OUTCOME_FLAGS = [
  FLAG.followUpRequired,
  FLAG.needsLabReview,
  FLAG.labsReviewedNoChanges,
] as const

export type FollowUpSendResult =
  | {
      status: 'applied'
      actionId: string | null
      addedFlagIds: number[]
      removedFlagIds: number[]
      warning?: string
    }
  | { status: 'error'; message: string }

/**
 * Create the customer service action and replace the review-outcome flags,
 * without finishing the review.
 *
 * The draft travels with the request so Finalize can be pressed between a
 * keystroke and the autosave. The protocol is re-priced here so the CS text
 * includes the same quote the confirmation screen showed.
 */
export async function applyLabReviewFollowUp(
  access: ProviderAccess,
  reviewId: string,
  draft: ReviewDraft
): Promise<FollowUpSendResult> {
  const admin = createAdminClient()

  const { data: review, error: reviewError } = await admin
    .from('lab_reviews')
    .select('id, patient_id')
    .eq('id', reviewId)
    .maybeSingle()
  if (reviewError) {
    return { status: 'error', message: `Could not load this review: ${reviewError.message}` }
  }
  if (!review) return { status: 'error', message: 'This review no longer exists.' }

  const patientId = review.patient_id as string
  const actor = await resolveActor(access)
  const protocol = protocolOutcome(
    await planProtocolFor(draft.newMedications, draftPricing(draft))
  )
  const plan = planCompletion(draft, actor.displayName, protocol)
  const { customerService } = reviewAudiences(draft, actor.displayName, protocol)
  const disposition = plan.detail.disposition
  const csPlan = planCsAction({
    customerService,
    dispositionLabel: DISPOSITION_LABELS[disposition],
  })

  const warnings: string[] = []
  const removedFlagIds = [...REVIEW_OUTCOME_FLAGS]
  const addedFlagIds = [...plan.addFlagIds]

  const { error: clearError } = await admin
    .from('user_flags_join')
    .delete()
    .eq('patient_id', patientId)
    .in('flag_id', removedFlagIds)
  if (clearError) {
    warnings.push('the previous review flags could not be cleared')
  }

  for (const flagId of addedFlagIds) {
    const added = await addPatientFlag(patientId, flagId, access.userId)
    if (!added) warnings.push(`flag ${flagId} could not be added`)
  }

  let actionId: string | null = null
  if (csPlan.kind === 'create') {
    const created = await createCsAction(access, {
      reviewId,
      patientId,
      title: csPlan.title,
      description: csPlan.description,
    })
    if (created.ok) {
      actionId = created.actionId
      if (created.warning) warnings.push(created.warning)
    } else {
      warnings.push(created.error)
    }
  }

  const logged = await logLabReviewEvent({
    labReviewId: reviewId,
    eventType: 'cs_action_requested',
    actor,
    summary:
      actionId != null
        ? `${actor.displayName} created a customer service action — ${csPlan.kind === 'create' ? csPlan.title : 'follow-up'}`
        : `${actor.displayName} updated the review flags`,
    metadata: { actionId, addedFlagIds, removedFlagIds },
  })
  if (!logged.ok) warnings.push(`the audit log entry failed (${logged.error})`)

  return {
    status: 'applied',
    actionId,
    addedFlagIds,
    removedFlagIds,
    warning: warnings.length ? warnings.join('; ') : undefined,
  }
}

async function createCsAction(
  access: ProviderAccess,
  input: { reviewId: string; patientId: string; title: string; description: string }
): Promise<
  { ok: true; actionId: string; warning?: string } | { ok: false; error: string }
> {
  const admin = createAdminClient()

  const [statusRow, priorityRow, csRole] = await Promise.all([
    admin.from('actions_statuses').select('id').eq('name', 'New').maybeSingle(),
    admin.from('actions_priorities').select('id').eq('name', 'Normal').maybeSingle(),
    admin.from('user_roles').select('id').eq('role', 'customer_service').maybeSingle(),
  ])

  const statusId = statusRow.data?.id
  const priorityId = priorityRow.data?.id
  const groupId = csRole.data?.id

  if (!statusId || !priorityId || !groupId) {
    return {
      ok: false,
      error: 'the customer service action could not be created (status, priority or group missing)',
    }
  }

  const { data: action, error: actionError } = await admin
    .from('actions')
    .insert({
      title: input.title,
      description: input.description,
      patient_user_id: input.patientId,
      created_by_user_id: access.userId,
      assignee_group_id: Number(groupId),
      status_id: statusId,
      priority_id: priorityId,
    })
    .select('id')
    .maybeSingle()

  if (actionError || !action) {
    return {
      ok: false,
      error: `the customer service action could not be created (${actionError?.message ?? 'unknown'})`,
    }
  }

  const { error: linkError } = await admin
    .from('lab_reviews')
    .update({ cs_action_id: action.id, updated_at: new Date().toISOString() })
    .eq('id', input.reviewId)
  if (linkError) {
    return {
      ok: true,
      actionId: action.id as string,
      warning: 'the customer service action was created but is not linked to this review',
    }
  }

  return { ok: true, actionId: action.id as string }
}
