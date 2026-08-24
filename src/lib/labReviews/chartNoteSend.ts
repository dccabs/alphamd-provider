import 'server-only'

import type { ProviderAccess } from '@/lib/authz'
import { planProtocolFor } from '@/lib/protocols/mutations'
import { protocolOutcome } from '@/lib/protocols/protocolPlan'
import { withPricingSnapshot } from '@/lib/protocols/snapshot'
import { createAdminClient } from '@/lib/supabase/admin'

import { planCompletion } from './completion'
import { logLabReviewEvent, resolveActor } from './events'
import type { ReviewDraft } from './reviewDraft'

export type ChartNoteSendResult =
  | { status: 'written'; warning?: string }
  | { status: 'error'; message: string }

/**
 * Write the completion chart note, without finishing the review.
 *
 * The note is `planCompletion`'s `note` — the provider's words plus the AI
 * summary — with the pricing snapshot link appended when a quote was just
 * emailed. The protocol is re-priced here so that line cannot disagree with
 * the quote.
 */
export async function writeLabReviewChartNote(
  access: ProviderAccess,
  reviewId: string,
  draft: ReviewDraft,
  snapshotId?: string | null
): Promise<ChartNoteSendResult> {
  const admin = createAdminClient()

  const { data: review, error: reviewError } = await admin
    .from('lab_reviews')
    .select('patient_id')
    .eq('id', reviewId)
    .maybeSingle()
  if (reviewError) {
    return { status: 'error', message: `Could not load this review: ${reviewError.message}` }
  }
  if (!review) return { status: 'error', message: 'This review no longer exists.' }

  const actor = await resolveActor(access)
  const protocol = protocolOutcome(await planProtocolFor(draft.newMedications))
  const plan = planCompletion(draft, actor.displayName, protocol)

  const { error: noteError } = await admin.from('patient_notes_private').insert({
    patient_id: review.patient_id,
    created_by: access.userId,
    note: withPricingSnapshot(plan.note, snapshotId),
  })
  if (noteError) {
    return { status: 'error', message: `the completion note could not be written (${noteError.message})` }
  }

  const logged = await logLabReviewEvent({
    labReviewId: reviewId,
    eventType: 'note_added',
    actor,
    summary: `${actor.displayName} wrote the completion note to the chart`,
  })

  return {
    status: 'written',
    warning: logged.ok ? undefined : `the audit log entry failed (${logged.error})`,
  }
}
