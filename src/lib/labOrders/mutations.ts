import 'server-only'

import type { ProviderAccess } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { logLabReviewEvent, resolveActor } from '@/lib/labReviews/events'
import {
  diagnosisPayload,
  orderNote,
  orderSummary,
  requestsPayload,
  scheduledDateFor,
  validateOrder,
  type LabOrder,
} from './order.ts'

/**
 * Placing and cancelling lab orders.
 *
 * Follows the same three rules as `labReviews/mutations.ts`: the caller has
 * already proven access, the review is re-read before anything is written, and the
 * write is recorded in the review's audit trail.
 *
 * ## Only `scheduled_lab_requisitions` is written
 *
 * Both "now" and "in twelve weeks" produce a row in the same table, differing only
 * in `scheduled_date`. The main app's `process-scheduled-labs` cron — which stays
 * in the main app — picks the row up, inserts the real `lab_requisitions` row,
 * emails the patient their order link and texts them. See the note in `order.ts`
 * for why this is preferred over porting the email and PDF stack into a second
 * app.
 *
 * The columns below are therefore a **contract with that cron**, not a local
 * choice. It selects on `status = 'pending'`, compares `scheduled_date` against
 * now, joins `lab_providers` and `user_list`, and copies `requests` and
 * `diagnosis_code` through verbatim. `status`, `lab_requisition_id` and
 * `processed_at` are left to their defaults because they are the cron's to set.
 */

export type OrderResult =
  | { ok: true; scheduledFor: string; immediate: boolean; warning?: string }
  | { ok: false; error: string }

/**
 * Statuses that mean a patient cannot be sent a lab order, mirroring the cron's
 * `isLabOrderBlockedStatus`: 10 is a cancelled subscription and 23 is a dropped
 * patient.
 *
 * The cron silently leaves such rows `pending` until they expire a week later, so
 * an order placed for one of these patients would look accepted here and then
 * never arrive. Refusing up front is the honest answer.
 */
const BLOCKED_PATIENT_STATUSES = [10, 23]

type ReviewSubject = {
  patientId: string
  status: string
  assignedTo: string | null
}

async function loadReview(reviewId: string): Promise<ReviewSubject | null> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('lab_reviews')
    .select('patient_id, status, assigned_to')
    .eq('id', reviewId)
    .maybeSingle()
  if (error) throw new Error(`lab_reviews lookup failed: ${error.message}`)
  if (!data?.patient_id) return null

  return {
    patientId: data.patient_id as string,
    status: data.status as string,
    assignedTo: (data.assigned_to as string | null) ?? null,
  }
}

async function patientFor(patientId: string): Promise<{ status: number | null; state: string | null }> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('user_list')
    .select('status, state')
    .eq('user_id', patientId)
    .maybeSingle()
  if (error) throw new Error(`user_list lookup failed: ${error.message}`)

  return {
    status: data?.status === null || data?.status === undefined ? null : Number(data.status),
    state: (data?.state as string | null) ?? null,
  }
}

/**
 * Place an order, dated now or in the future.
 *
 * The order is validated a second time here against the patient's **real** state
 * read from the database, not the one the browser was rendered with. The comped-
 * labs restriction is a legal one in New York and New Jersey, so it cannot rest on
 * a value a client could have edited or that could be minutes stale.
 */
export async function scheduleLabOrder(
  access: ProviderAccess,
  reviewId: string,
  order: LabOrder
): Promise<OrderResult> {
  const review = await loadReview(reviewId)
  if (!review) return { ok: false, error: 'This review no longer exists.' }

  const patient = await patientFor(review.patientId)

  const problems = validateOrder(order, patient.state)
  if (problems.length) return { ok: false, error: problems.join(' ') }

  if (patient.status !== null && BLOCKED_PATIENT_STATUSES.includes(patient.status)) {
    return {
      ok: false,
      error:
        'This patient’s subscription is cancelled or dropped, so a lab order would never be sent. Reactivate them first.',
    }
  }

  const scheduledDate = scheduledDateFor(order.timing, order.customDate)
  if (!scheduledDate) return { ok: false, error: 'Enter the date these labs should be sent.' }

  const immediate = order.timing === 'now'
  const admin = createAdminClient()

  const { data: inserted, error } = await admin
    .from('scheduled_lab_requisitions')
    .insert({
      patient_id: review.patientId,
      created_by: access.userId,
      provider_id: order.providerId,
      requests: JSON.stringify(requestsPayload(order)),
      diagnosis_code: JSON.stringify(diagnosisPayload(order)),
      scheduled_date: scheduledDate.toISOString(),
      // Suppresses the cron's "your labs are scheduled for <date> — this is NOT
      // for now" heads-up email. For a future order the heads-up is the point; for
      // an order placed now it would arrive in the same cron run as the order
      // itself and contradict it.
      notification_email_sent_at: immediate ? new Date().toISOString() : null,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: `Could not place the order: ${error.message}` }

  const warnings: string[] = []

  const noteFailed = await writeChartNote(
    review.patientId,
    access.userId,
    orderNote(order, scheduledDate, immediate)
  )
  if (noteFailed) warnings.push('the order note could not be written to the chart')

  await bumpOnboardingStatus(review.patientId)

  const actor = await resolveActor(access)
  const logged = await logLabReviewEvent({
    labReviewId: reviewId,
    eventType: 'labs_ordered',
    actor,
    summary: orderSummary(order, scheduledDate, immediate),
    metadata: {
      scheduledLabRequisitionId: inserted.id,
      scheduledFor: scheduledDate.toISOString(),
      immediate,
      testCodes: order.testCodes,
      diagnosisCodes: order.diagnosisCodes,
      compedCodes: order.compedCodes,
    },
  })
  if (!logged.ok) warnings.push("it is not in the review's history")

  return {
    ok: true,
    scheduledFor: scheduledDate.toISOString(),
    immediate,
    warning: warnings.length
      ? `The order was placed, but ${warnings.join(' and ')}. Tell an administrator.`
      : undefined,
  }
}

/**
 * Cancel a pending order.
 *
 * A status change rather than a delete, matching the main app — and only from
 * `pending`. Once the cron has processed a row the patient already has the order
 * email, so "cancelled" here would be a lie; cancelling the issued requisition is
 * a separate action that still lives in the main app.
 */
export async function cancelScheduledLabOrder(
  access: ProviderAccess,
  reviewId: string,
  scheduledId: string
): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  const review = await loadReview(reviewId)
  if (!review) return { ok: false, error: 'This review no longer exists.' }

  const admin = createAdminClient()

  // Scoped to this review's patient as well as the row id, so a tampered id
  // cannot cancel an order belonging to somebody else's chart.
  const { data: updated, error } = await admin
    .from('scheduled_lab_requisitions')
    .update({ status: 'cancelled' })
    .eq('id', scheduledId)
    .eq('patient_id', review.patientId)
    .eq('status', 'pending')
    .select('id, scheduled_date')
    .maybeSingle()

  if (error) return { ok: false, error: `Could not cancel the order: ${error.message}` }
  if (!updated) {
    return {
      ok: false,
      error: 'That order is no longer pending — it has already been sent, expired or cancelled.',
    }
  }

  const actor = await resolveActor(access)
  const logged = await logLabReviewEvent({
    labReviewId: reviewId,
    eventType: 'labs_order_cancelled',
    actor,
    summary: 'Cancelled a scheduled lab order',
    metadata: {
      scheduledLabRequisitionId: scheduledId,
      scheduledFor: updated.scheduled_date,
    },
  })

  return {
    ok: true,
    warning: logged.ok
      ? undefined
      : "The order was cancelled, but it is not in the review's history. Tell an administrator.",
  }
}

/** True when the note failed. Plain text, like every other note writer here. */
async function writeChartNote(
  patientId: string,
  createdBy: string,
  note: string
): Promise<boolean> {
  const admin = createAdminClient()
  const { error } = await admin.from('patient_notes_private').insert({
    patient_id: patientId,
    created_by: createdBy,
    note,
  })
  return Boolean(error)
}

/**
 * Move an onboarding patient from 3 ("Scheduled Appointment") to 4 ("Attended
 * Initial Consultation — ordered a test"), mirroring the main app's
 * `bumpOnboardingStatusOnLab`.
 *
 * Guarded on the current value in both the read and the update, so it can never
 * pull a patient *backwards* out of a later status. Best-effort: a failed bump is
 * logged and swallowed, because it must not fail an order that was placed.
 */
async function bumpOnboardingStatus(patientId: string): Promise<void> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('user_list')
    .select('status')
    .eq('user_id', patientId)
    .maybeSingle()
  if (error || Number(data?.status) !== 3) return

  const { error: updateError } = await admin
    .from('user_list')
    .update({ status: 4 })
    .eq('user_id', patientId)
    .eq('status', 3)

  if (updateError) {
    console.error(`[labOrders] onboarding bump 3 -> 4 failed: ${updateError.message}`)
  }
}
