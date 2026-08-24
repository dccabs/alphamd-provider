/**
 * The consultation invitation email.
 *
 * The HTML is the admin app's `ConsultationLinkEmail`, rendered next door.
 * This file is the subject line and the plain-text part that goes with it —
 * the original is HTML-only, so a client that shows the text part would
 * otherwise render an empty message with no way to book.
 *
 * The letter is the same one `POST /api/send-consultation-link` sends. A
 * provider message typed on the consult step is not interpolated here: that
 * template has no place for it, and a patient who has had this email before
 * should recognise this one.
 */

export const INVITE_SUBJECT = 'Schedule your AlphaMD Consultation'

export const INVITE_FROM = 'AlphaMD <noreply@alphamd.org>'

const SUPPORT_EMAIL = 'contact@alphamd.org'

export type InviteContent = { subject: string; text: string }

export function consultationInvite(options: {
  firstName: string | null
  bookingUrl: string
  eventTypeName: string
}): InviteContent {
  const greeting = options.firstName?.trim()
    ? `Dear ${options.firstName.trim()},`
    : 'Dear Valued Patient,'

  const text = [
    greeting,
    "We're ready to help you on your health journey! Please click the secure booking link below to schedule your consultation with one of our experienced AlphaMD providers.",
    `Consultation Type: ${options.eventTypeName}`,
    'This personalized booking link has been created specifically for you and provides access to our available appointment slots. For your security and to ensure dedicated time slots, this is a single-use link that will expire once you\'ve booked your appointment.',
    `Schedule here: ${options.bookingUrl}`,
    'During your consultation, our providers will discuss your health goals, review any relevant medical history, and create a personalized treatment plan tailored to your needs. We look forward to supporting you on your wellness journey.',
    `Important: This secure link can only be used once and is valid for scheduling your consultation. If you experience any technical difficulties or have questions, please contact our support team at ${SUPPORT_EMAIL}.`,
    `Questions? Contact us at ${SUPPORT_EMAIL}.`,
    'Thank you for choosing AlphaMD for your healthcare needs.',
  ].join('\n\n')

  return { subject: INVITE_SUBJECT, text }
}
