import 'server-only'

import type { ProviderAccess } from '@/lib/authz'
import { createSingleUseSchedulingLink } from '@/lib/calendly'
import { sendPauboxEmail } from '@/lib/paubox'
import { createAdminClient } from '@/lib/supabase/admin'
import { logLabReviewEvent, resolveActor } from '@/lib/labReviews/events'
import { eventTypeById } from './eventTypes.ts'
import { INVITE_FROM, consultationInvite } from './inviteEmail.ts'

/**
 * Inviting a patient to book a consultation.
 *
 * Three steps, in an order chosen so that a failure never leaves the patient
 * misinformed:
 *
 *  1. Mint the single-use Calendly link. If this fails nothing has happened yet and
 *     the provider gets a plain error.
 *  2. Email it through Paubox. If *this* fails the link exists but is unused, which
 *     costs nothing — so the failure is reported as an error and the provider can
 *     retry, or copy the link out and send it another way.
 *  3. Record it: a note on the chart and an entry in the review's audit trail. Only
 *     now, because these say the patient *was invited*, and writing them before the
 *     email would make that a lie whenever the send failed.
 *
 * The main app writes nothing at request time — no note, no audit entry — so
 * whether a patient was ever asked to book is invisible until they do. That gap is
 * closed here rather than ported.
 */

export type ConsultRequestResult =
  | { ok: true; bookingUrl: string; sentTo: string; warning?: string }
  | { ok: false; error: string }

type Subject = {
  patientId: string
  firstName: string | null
  fullName: string | null
  email: string | null
  gender: string | null
  statusId: number | null
}

async function subjectOf(reviewId: string): Promise<Subject | null> {
  const admin = createAdminClient()

  const { data: review, error: reviewError } = await admin
    .from('lab_reviews')
    .select('patient_id')
    .eq('id', reviewId)
    .maybeSingle()
  if (reviewError) throw new Error(`lab_reviews lookup failed: ${reviewError.message}`)
  if (!review?.patient_id) return null

  const patientId = review.patient_id as string

  const { data, error } = await admin
    .from('user_list')
    .select('first_name, last_name, preferred_name, full_name, email, gender, status')
    .eq('user_id', patientId)
    .maybeSingle()
  if (error) throw new Error(`user_list lookup failed: ${error.message}`)

  const first = (data?.preferred_name as string | null) || (data?.first_name as string | null)
  const full =
    [data?.first_name, data?.last_name].filter(Boolean).join(' ').trim() ||
    ((data?.full_name as string | null) ?? null)

  return {
    patientId,
    firstName: first?.trim() || null,
    fullName: full || null,
    email: (data?.email as string | null)?.trim() || null,
    gender: (data?.gender as string | null) ?? null,
    statusId:
      data?.status === null || data?.status === undefined ? null : Number(data.status),
  }
}

export async function requestConsultation(
  access: ProviderAccess,
  reviewId: string,
  input: { eventTypeId: string; message: string }
): Promise<ConsultRequestResult> {
  const eventType = eventTypeById(input.eventTypeId)
  if (!eventType) return { ok: false, error: 'Choose a consultation type.' }

  const subject = await subjectOf(reviewId)
  if (!subject) return { ok: false, error: 'This review no longer exists.' }

  // The address is read from the chart, not accepted from the request. It decides
  // where a message naming this patient's care is delivered, and the booking
  // webhook matches the invitee back to the chart by the same address.
  if (!subject.email) {
    return {
      ok: false,
      error: 'This patient has no email address on file, so an invitation cannot be sent.',
    }
  }

  const link = await createSingleUseSchedulingLink({
    eventTypeId: eventType.id,
    email: subject.email,
    name: subject.fullName,
  })
  if (!link.ok) return { ok: false, error: link.error }

  const invite = consultationInvite({
    firstName: subject.firstName,
    bookingUrl: link.url,
    eventTypeName: eventType.name,
    message: input.message,
  })

  const sent = await sendPauboxEmail({
    from: INVITE_FROM,
    to: subject.email,
    subject: invite.subject,
    text: invite.text,
    html: invite.html,
  })
  if (!sent.ok) {
    return {
      ok: false,
      error: `${sent.error} The booking link was created but not sent — copy it from the panel and send it another way, or try again.`,
    }
  }

  const warnings: string[] = []

  const admin = createAdminClient()
  const { error: noteError } = await admin.from('patient_notes_private').insert({
    patient_id: subject.patientId,
    created_by: access.userId,
    note: chartNote(eventType.name, subject.email, input.message),
  })
  if (noteError) warnings.push('it is not on the chart')

  const actor = await resolveActor(access)
  const logged = await logLabReviewEvent({
    labReviewId: reviewId,
    eventType: 'consultation_requested',
    actor,
    summary: `Sent a booking link for ${eventType.name}`,
    metadata: {
      eventTypeId: eventType.id,
      eventTypeName: eventType.name,
      sentTo: subject.email,
      expiresAt: link.expiresAt,
    },
  })
  if (!logged.ok) warnings.push("it is not in the review's history")

  return {
    ok: true,
    bookingUrl: link.url,
    sentTo: subject.email,
    warning: warnings.length
      ? `The invitation was sent, but ${warnings.join(' and ')}. Tell an administrator.`
      : undefined,
  }
}

/** Plain text, like every other note this app writes. The booking link itself is
 *  deliberately left out: it is single-use and would be dead by the time anyone
 *  read the note. */
function chartNote(eventTypeName: string, sentTo: string, message: string): string {
  const parts = [`Consultation booking link sent to ${sentTo} for: ${eventTypeName}.`]
  if (message.trim()) parts.push(`Message to the patient:\n${message.trim()}`)
  return parts.join('\n\n')
}
