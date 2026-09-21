import 'server-only'

import { logLabReviewEvent, type Actor } from '@/lib/labReviews/events'
import { logProviderQuestionEvent } from '@/lib/providerQuestions/events'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The work row a toolkit action hangs off: a Lab Review or a Provider Question.
 *
 * Lab orders, consultations and the AI helper were written against a review id.
 * A Provider Question uses the same toolkit, so those paths now resolve the id
 * here: `lab_reviews` first, then `provider_questions`. Both are UUID primary
 * keys, so an id names at most one row. The patient is always read from the
 * row, never from the request — see `labOrders/mutations.ts` for why.
 *
 * Audit entries route the same way: an order placed from a Provider Question
 * is in that question's history, not in a Lab Review's.
 */

export type WorkKind = 'lab_review' | 'provider_question'

export type WorkSubject = {
  kind: WorkKind
  id: string
  patientId: string
  status: string
  assignedTo: string | null
  /** Lab Review only: the AI report the summary was written from. */
  reportId: string | null
  /** Provider Question only. */
  question: string | null
  csComments: string | null
}

export async function resolveWorkSubject(id: string): Promise<WorkSubject | null> {
  if (!id) return null
  const admin = createAdminClient()

  const review = await admin
    .from('lab_reviews')
    .select('id, patient_id, status, assigned_to, report_id')
    .eq('id', id)
    .maybeSingle()
  if (review.error) throw new Error(`lab_reviews lookup failed: ${review.error.message}`)
  if (review.data?.patient_id) {
    return {
      kind: 'lab_review',
      id,
      patientId: review.data.patient_id as string,
      status: review.data.status as string,
      assignedTo: (review.data.assigned_to as string | null) ?? null,
      reportId: (review.data.report_id as string | null) ?? null,
      question: null,
      csComments: null,
    }
  }

  const question = await admin
    .from('provider_questions')
    .select('id, patient_id, status, assigned_to, question, cs_comments')
    .eq('id', id)
    .maybeSingle()
  if (question.error) {
    throw new Error(`provider_questions lookup failed: ${question.error.message}`)
  }
  if (!question.data?.patient_id) return null

  return {
    kind: 'provider_question',
    id,
    patientId: question.data.patient_id as string,
    status: question.data.status as string,
    assignedTo: (question.data.assigned_to as string | null) ?? null,
    reportId: null,
    question: (question.data.question as string | null) ?? null,
    csComments: (question.data.cs_comments as string | null) ?? null,
  }
}

/** The events the two work types share. Each table's type list includes them. */
export type SharedWorkEventType =
  | 'labs_ordered'
  | 'labs_order_cancelled'
  | 'consultation_requested'

/** Append to whichever history this subject has. */
export async function logWorkEvent(
  subject: Pick<WorkSubject, 'kind' | 'id'>,
  entry: {
    eventType: SharedWorkEventType
    actor: Actor
    summary: string
    metadata?: Record<string, unknown>
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (subject.kind === 'provider_question') {
    return logProviderQuestionEvent({ providerQuestionId: subject.id, ...entry })
  }
  return logLabReviewEvent({ labReviewId: subject.id, ...entry })
}

/** What the history calls this row when a warning names it. */
export function workNoun(kind: WorkKind): string {
  return kind === 'provider_question' ? 'question' : 'review'
}
