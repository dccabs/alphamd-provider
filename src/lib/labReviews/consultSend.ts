import 'server-only'

import type { ProviderAccess } from '@/lib/authz'
import { consultProblems, requestConsultation } from '@/lib/consultations/mutations'
import type { ConsultRequest } from '@/lib/consultations/request'
import { createAdminClient } from '@/lib/supabase/admin'

export type ConsultSendResult =
  | { status: 'skipped' }
  | { status: 'sent'; warning?: string }
  | { status: 'error'; message: string }

/**
 * Email the consultation booking link, without finishing the review.
 *
 * Reuses `requestConsultation`, so an invitation from Approve is the same
 * Paubox email, chart note, and audit entry as one sent at finish.
 */
export async function sendLabReviewConsultation(
  access: ProviderAccess,
  reviewId: string,
  request: ConsultRequest | null
): Promise<ConsultSendResult> {
  if (!request) return { status: 'skipped' }

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

  const problems = await consultProblems(review.patient_id as string, request)
  if (problems.length) return { status: 'error', message: problems.join(' ') }

  const result = await requestConsultation(access, reviewId, request)
  if (!result.ok) return { status: 'error', message: result.error }

  return { status: 'sent', warning: result.warning }
}
