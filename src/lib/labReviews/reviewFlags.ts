import 'server-only'

import { addPatientFlag } from '@/lib/patients/flags'
import { CLINIC_TIME_ZONE } from '@/lib/protocols/labels'
import { createAdminClient } from '@/lib/supabase/admin'

import { FLAG, FLAG_LABELS } from './clinicalIds'
import type { CompletionPlan } from './completion'

/**
 * Flags a finished review clears before raising its own.
 *
 * Only flags a review owns outright. Follow Up Required and Dose Change are never
 * cleared here: other parts of the admin app raise them too, and CS removes them
 * once everything in their note is done. Protocol-sent pricing (flag 5) is owned
 * by `sendProtocol`.
 */
export const REVIEW_OWNED_FLAGS = [FLAG.needsLabReview, FLAG.labsReviewedNoChanges] as const

/**
 * Clear the review-owned flags, then raise the plan's flags with their notes.
 *
 * Returns warnings, never throws: by the time this runs the provider has already
 * approved, and the fix for a flag that did not apply is manual.
 */
export async function applyReviewFlags(input: {
  reviewId: string
  patientId: string
  staffUserId: string
  providerName: string
  plan: Pick<CompletionPlan, 'addFlagIds' | 'flagNotes'>
}): Promise<{ removedFlagIds: number[]; warnings: string[] }> {
  const admin = createAdminClient()
  const warnings: string[] = []
  const removedFlagIds = [...REVIEW_OWNED_FLAGS]

  const { error: clearError } = await admin
    .from('user_flags_join')
    .delete()
    .eq('patient_id', input.patientId)
    .in('flag_id', removedFlagIds)
  if (clearError) warnings.push('the previous review flags could not be cleared')

  const heading = `Lab review by ${input.providerName}, ${new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: CLINIC_TIME_ZONE,
  })}`

  for (const flagId of input.plan.addFlagIds) {
    const body = input.plan.flagNotes[flagId]
    const added = await addPatientFlag(
      input.patientId,
      flagId,
      input.staffUserId,
      body ? { ref: input.reviewId.slice(0, 8), heading, body } : undefined
    )
    if (!added) warnings.push(`the "${FLAG_LABELS[flagId] ?? flagId}" flag could not be added`)
  }

  return { removedFlagIds, warnings }
}
