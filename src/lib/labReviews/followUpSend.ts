import 'server-only'

import type { ProviderAccess } from '@/lib/authz'
import { planProtocolFor } from '@/lib/protocols/mutations'
import { protocolOutcome } from '@/lib/protocols/protocolPlan'
import { createAdminClient } from '@/lib/supabase/admin'

import { draftPricing } from './discountSeed'
import { planCompletion } from './completion'
import { FLAG, FLAG_LABELS } from './clinicalIds'
import { logLabReviewEvent, resolveActor } from './events'
import { applyReviewFlags } from './reviewFlags'
import type { ReviewDraft } from './reviewDraft'

export type FollowUpSendResult =
  | {
      status: 'applied'
      addedFlagIds: number[]
      removedFlagIds: number[]
      warning?: string
    }
  | { status: 'error'; message: string }

/**
 * Raise the review's Patient Flags for customer service, without finishing the
 * review. A Lab Review never creates an Action: what CS has to do is written on
 * the flag, which shows on the admin app's Flagged Patients list.
 *
 * The draft travels with the request so Finalize can be pressed between a
 * keystroke and the autosave. The protocol is re-priced here so a handoff is
 * flagged exactly as the confirmation screen showed it.
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

  const { removedFlagIds, warnings } = await applyReviewFlags({
    reviewId,
    patientId,
    staffUserId: access.userId,
    providerName: actor.displayName,
    plan,
  })
  const addedFlagIds = plan.addFlagIds
  const forCs = addedFlagIds.filter(
    (id) => id === FLAG.followUpRequired || id === FLAG.doseChange
  )

  const logged = await logLabReviewEvent({
    labReviewId: reviewId,
    eventType: 'cs_action_requested',
    actor,
    summary: forCs.length
      ? `${actor.displayName} flagged the patient for customer service — ${forCs
          .map((id) => FLAG_LABELS[id])
          .join(', ')}`
      : `${actor.displayName} updated the review flags`,
    metadata: { addedFlagIds, removedFlagIds, flagNotes: plan.flagNotes },
  })
  if (!logged.ok) warnings.push(`the audit log entry failed (${logged.error})`)

  return {
    status: 'applied',
    addedFlagIds,
    removedFlagIds,
    warning: warnings.length ? warnings.join('; ') : undefined,
  }
}
