import 'server-only'

import type { ProviderAccess } from '@/lib/authz'
import { handoffLines, planProtocolFor, sendProtocol } from '@/lib/protocols/mutations'
import { createAdminClient } from '@/lib/supabase/admin'

import { draftPricing } from './discountSeed'
import type { ReviewDraft } from './reviewDraft'

export type ProtocolSendFromReview =
  | { status: 'skipped' }
  | { status: 'handed-off'; reasons: string[] }
  | { status: 'sent'; snapshotId: string; warning?: string }
  | { status: 'error'; message: string }

/**
 * Send the recommended protocol for a lab review, without finishing the review.
 *
 * The same split as `sendLabReviewPatientMessage`: the review id names the
 * patient, the medications travel with the request so a keystroke that has not
 * autosaved still prices, and the review row is left unfinished. `sendProtocol`
 * is where the quote, the email, the chart note and the consents live.
 */
export async function sendLabReviewProtocol(
  access: ProviderAccess,
  reviewId: string,
  draft: ReviewDraft
): Promise<ProtocolSendFromReview> {
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

  try {
    const plan = await planProtocolFor(draft.newMedications, draftPricing(draft))
    const result = await sendProtocol(
      access,
      reviewId,
      review.patient_id as string,
      plan,
      draft.newMedications
    )

    switch (result.kind) {
      case 'nothing-to-send':
        return { status: 'skipped' }

      case 'handed-off':
        return { status: 'handed-off', reasons: handoffLines(result.blocks) }

      case 'failed':
        return { status: 'error', message: result.error }

      case 'sent':
        return {
          status: 'sent',
          snapshotId: result.snapshotId,
          warning: result.warnings.length ? result.warnings.join('; ') : undefined,
        }
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'the recommended protocol could not be sent',
    }
  }
}
