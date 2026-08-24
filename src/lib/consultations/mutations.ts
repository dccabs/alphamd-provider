import 'server-only'

import type { ProviderAccess } from '@/lib/authz'
import { createSingleUseSchedulingLink } from '@/lib/calendly'
import { greetingName } from '@/lib/patientName'
import { sendPauboxEmail } from '@/lib/paubox'
import { createAdminClient } from '@/lib/supabase/admin'
import { logLabReviewEvent, resolveActor } from '@/lib/labReviews/events'
import { eventTypeById } from './eventTypes.ts'
import { INVITE_FROM, consultationInvite } from './inviteEmail.ts'
import { renderConsultationInviteHtml } from './inviteEmailHtml'
import { needsLink, validateConsultRequest, type ConsultRequest } from './request.ts'

/**
 * Inviting a patient to book a consultation.
 *
 * Called when a review is approved, not when the provider chooses the type — what
 * they choose is held in the draft by `ConsultRequest`. So by the time this runs
 * the review is already finished, and `consultProblems` has already refused the
 * completion for the failures a provider could have done something about.
 *
 * Three steps, in an order chosen so that a failure never leaves the patient
 * misinformed:
 *
 *  1. Take the booking link the dialog already minted, or mint one if that request
 *     predates early minting. If this fails nothing has happened yet.
 *  2. Email it through Paubox. If *this* fails the link exists but is unused, which
 *     costs nothing and leaves the patient knowing nothing about an appointment.
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
  /** What the invite email opens with — see `greetingName`. */
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

  return subjectFor(review.patient_id as string)
}

async function subjectFor(patientId: string): Promise<Subject> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('user_list')
    .select('first_name, last_name, preferred_name, full_name, email, gender, status')
    .eq('user_id', patientId)
    .maybeSingle()
  if (error) throw new Error(`user_list lookup failed: ${error.message}`)

  const full =
    [data?.first_name, data?.last_name].filter(Boolean).join(' ').trim() ||
    ((data?.full_name as string | null) ?? null)

  return {
    patientId,
    firstName: greetingName({
      preferredName: data?.preferred_name as string | null,
      firstName: data?.first_name as string | null,
      lastName: data?.last_name as string | null,
    }),
    fullName: full || null,
    email: (data?.email as string | null)?.trim() || null,
    gender: (data?.gender as string | null) ?? null,
    statusId:
      data?.status === null || data?.status === undefined ? null : Number(data.status),
  }
}

/**
 * Whether this invitation could be sent for this patient, without sending it.
 *
 * The counterpart of `labOrderProblems`, and there for the same reason: by the
 * time `requestConsultation` runs the review has already been marked finished, so
 * a refusal there can only be reported as a warning about an invitation that never
 * went out. Both things it checks — an address on file, a type that still exists —
 * are things the provider can fix while the review is still open, which is the
 * whole point of asking first.
 *
 * Returns the problems, or an empty array when the invitation can be sent.
 */
export async function consultProblems(
  patientId: string,
  request: ConsultRequest | null
): Promise<string[]> {
  if (!request) return []

  const problems = validateConsultRequest(request)

  const subject = await subjectFor(patientId)
  if (!subject.email) {
    problems.push(
      'This patient has no email address on file, so the consultation invitation cannot be sent. Add one, or remove the request.'
    )
  }

  return problems
}

/**
 * Mint the booking link for a consultation being composed, and nothing else.
 *
 * Deliberately narrow. It sends no email, writes no note and logs no audit entry,
 * because at the moment it runs the provider has decided nothing — they are still
 * writing the review, and may yet change the type or remove the request. All it
 * buys is that the one step depending on Calendly happens where a failure is
 * recoverable, rather than after the review has been marked finished.
 *
 * An unused link costs nothing and is held by nobody, so a provider who mints one
 * and then changes their mind has wasted an API call and no more.
 */
export type MintedLink =
  | { ok: true; bookingUrl: string; expiresAt: string | null }
  | { ok: false; error: string }

export async function mintConsultLink(reviewId: string, eventTypeId: string): Promise<MintedLink> {
  const eventType = eventTypeById(eventTypeId)
  if (!eventType) return { ok: false, error: 'Choose a consultation type.' }

  const subject = await subjectOf(reviewId)
  if (!subject) return { ok: false, error: 'This review no longer exists.' }
  if (!subject.email) return { ok: false, error: NO_EMAIL }

  const link = await createSingleUseSchedulingLink({
    eventTypeId: eventType.id,
    email: subject.email,
    name: subject.fullName,
  })
  if (!link.ok) return { ok: false, error: link.error }

  return { ok: true, bookingUrl: link.url, expiresAt: link.expiresAt }
}

const NO_EMAIL = 'This patient has no email address on file, so an invitation cannot be sent.'

export async function requestConsultation(
  access: ProviderAccess,
  reviewId: string,
  input: ConsultRequest
): Promise<ConsultRequestResult> {
  const eventType = eventTypeById(input.eventTypeId)
  if (!eventType) return { ok: false, error: 'Choose a consultation type.' }

  const subject = await subjectOf(reviewId)
  if (!subject) return { ok: false, error: 'This review no longer exists.' }

  // The address is read from the chart, not accepted from the request. It decides
  // where a message naming this patient's care is delivered, and the booking
  // webhook matches the invitee back to the chart by the same address.
  if (!subject.email) return { ok: false, error: NO_EMAIL }

  // Normally already minted, by the dialog, when the provider attached this. Minted
  // here only for a request staged by an older build, or one whose link outlived the
  // draft it was sitting in.
  const bookingUrl = await linkFor(input, reviewId, subject)
  if (!bookingUrl.ok) return { ok: false, error: bookingUrl.error }

  const invite = consultationInvite({
    firstName: subject.firstName,
    bookingUrl: bookingUrl.url,
    eventTypeName: eventType.name,
  })

  const sent = await sendPauboxEmail({
    from: INVITE_FROM,
    to: subject.email,
    subject: invite.subject,
    text: invite.text,
    html: await renderConsultationInviteHtml({
      firstName: subject.firstName,
      bookingUrl: bookingUrl.url,
      eventTypeName: eventType.name,
    }),
  })
  if (!sent.ok) {
    return {
      ok: false,
      error: `${sent.error} A booking link was created but not sent, so the patient has not been asked to book. Request the consultation again.`,
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
      mintedAtApproval: bookingUrl.minted,
    },
  })
  if (!logged.ok) warnings.push("it is not in the review's history")

  return {
    ok: true,
    bookingUrl: bookingUrl.url,
    sentTo: subject.email,
    warning: warnings.length
      ? `The invitation was sent, but ${warnings.join(' and ')}. Tell an administrator.`
      : undefined,
  }
}

/**
 * The link to send: the one staged with the request, or a fresh one.
 *
 * `minted` is recorded in the audit entry rather than thrown away, because minting
 * here means the dialog did not — which is either a draft that predates early
 * minting or one that sat open for three months, and both are worth being able to
 * spot afterwards.
 */
async function linkFor(
  request: ConsultRequest,
  reviewId: string,
  subject: Subject
): Promise<{ ok: true; url: string; minted: boolean } | { ok: false; error: string }> {
  if (!needsLink(request)) return { ok: true, url: request.bookingUrl, minted: false }

  const link = await createSingleUseSchedulingLink({
    eventTypeId: request.eventTypeId,
    email: subject.email,
    name: subject.fullName,
  })
  if (!link.ok) return { ok: false, error: link.error }

  return { ok: true, url: link.url, minted: true }
}

/** Plain text, like every other note this app writes. The booking link itself is
 *  deliberately left out: it is single-use and would be dead by the time anyone
 *  read the note. */
function chartNote(eventTypeName: string, sentTo: string, message: string): string {
  const parts = [`Consultation booking link sent to ${sentTo} for: ${eventTypeName}.`]
  if (message.trim()) parts.push(`Message to the patient:\n${message.trim()}`)
  return parts.join('\n\n')
}
