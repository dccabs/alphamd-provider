/**
 * What finishing will one day send to the patient, decided as a pure function.
 *
 * The confirmation screen's first live job is a Zendesk ticket carrying the
 * typed patient message. The *decision* about whether that ticket should exist
 * is separated from creating it, so empty-message and missing-email cases can
 * be unit-tested without touching Zendesk.
 *
 * Empty wins over missing email: a review that says nothing to the patient is
 * a skip, not a failure, even if we could not have emailed them. A ticket with
 * no reachable requester is the false success this exists to prevent.
 */

/** Patient-facing — Zendesk uses this as the email subject. */
export const LAB_REVIEW_TICKET_SUBJECT = 'Your lab results have been reviewed'

/** We wrote; the ball is with the patient. */
export const LAB_REVIEW_TICKET_STATUS = 'pending' as const

/** Baseline customer support, matching the Alpha admin create-ticket path. */
export const BASELINE_CS_GROUP_ID = 11096446848015

export type PatientTicketPlan =
  | { kind: 'skip' }
  | { kind: 'refuse'; error: string }
  | {
      kind: 'send'
      subject: typeof LAB_REVIEW_TICKET_SUBJECT
      status: typeof LAB_REVIEW_TICKET_STATUS
      groupId: typeof BASELINE_CS_GROUP_ID
      body: string
      requesterName: string
      requesterEmail: string
    }

export function planPatientTicket(input: {
  message: string
  email: string | null
  requesterName: string
}): PatientTicketPlan {
  const body = input.message.trim()
  if (!body) return { kind: 'skip' }

  const email = input.email?.trim() || null
  if (!email) {
    return {
      kind: 'refuse',
      error: 'This patient has no email address on file, so a ticket was not created.',
    }
  }

  const requesterName = input.requesterName.trim() || email

  return {
    kind: 'send',
    subject: LAB_REVIEW_TICKET_SUBJECT,
    status: LAB_REVIEW_TICKET_STATUS,
    groupId: BASELINE_CS_GROUP_ID,
    body,
    requesterName,
    requesterEmail: email,
  }
}
