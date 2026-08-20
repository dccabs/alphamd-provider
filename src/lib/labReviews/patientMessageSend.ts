import 'server-only'

import type { ProviderAccess } from '@/lib/authz'
import { DEFAULT_REPLY_IDENTITY, type ReplyIdentity } from '@/lib/labReviews/replyIdentity'
import { createAdminClient } from '@/lib/supabase/admin'
import { createTicket } from '@/lib/zendesk'

import { planPatientTicket } from './patientTicket'

export type PatientMessageSendResult =
  | { status: 'skipped' }
  | { status: 'sent'; ticketId: number; sentAs: ReplyIdentity; warning?: string }
  | { status: 'error'; message: string }

/**
 * Create the Zendesk ticket for a lab-review patient message.
 *
 * Not a review mutation: the review is left unfinished, and nothing is written
 * to the chart. The patient id is read from the review row rather than the
 * request, so this cannot be aimed at a different patient than the one on
 * screen. The message itself comes from the request because Finalize can be
 * pressed between a keystroke and the autosave debounce.
 */
export async function sendLabReviewPatientMessage(
  access: ProviderAccess,
  reviewId: string,
  message: string
): Promise<PatientMessageSendResult> {
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

  const { data: patient, error: patientError } = await admin
    .from('user_list')
    .select('first_name, last_name, email')
    .eq('user_id', review.patient_id)
    .maybeSingle()
  if (patientError) {
    return { status: 'error', message: `Could not load this patient: ${patientError.message}` }
  }
  if (!patient) return { status: 'error', message: 'This patient no longer exists.' }

  const requesterName = [patient.first_name, patient.last_name].filter(Boolean).join(' ').trim()
  const plan = planPatientTicket({
    message,
    email: (patient.email as string | null) ?? null,
    requesterName,
  })

  if (plan.kind === 'skip') return { status: 'skipped' }
  if (plan.kind === 'refuse') return { status: 'error', message: plan.error }

  const result = await createTicket({
    subject: plan.subject,
    body: plan.body,
    requesterName: plan.requesterName,
    requesterEmail: plan.requesterEmail,
    status: plan.status,
    groupId: plan.groupId,
    authorEmail: access.email,
    as: DEFAULT_REPLY_IDENTITY,
  })

  if (!result.ok) return { status: 'error', message: result.error }
  return {
    status: 'sent',
    ticketId: result.ticketId,
    sentAs: result.sentAs,
    warning: result.warning,
  }
}
