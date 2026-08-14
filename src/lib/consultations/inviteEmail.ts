/**
 * The consultation invitation email.
 *
 * Pure — takes strings, returns strings — so the wording a patient receives is
 * reviewable in a diff and testable without sending mail.
 *
 * Ported from the main app's `ConsultationLinkEmail` React Email component,
 * keeping its subject line and its substance so a patient who has had one before
 * recognises this one. Two changes:
 *
 *  - **A plain-text part is included.** The original is HTML-only, so a client
 *    that shows the text part renders an empty message with no way to book.
 *  - The copy is shorter. The original explains what happens during a
 *    consultation at length above the fold; the one thing this email exists to
 *    carry is the link.
 */

export const INVITE_SUBJECT = 'Schedule your AlphaMD Consultation'

export const INVITE_FROM = 'AlphaMD <noreply@alphamd.org>'

const SUPPORT_EMAIL = 'contact@alphamd.org'

export type InviteContent = { subject: string; text: string; html: string }

export function consultationInvite(options: {
  firstName: string | null
  bookingUrl: string
  eventTypeName: string
  /** The provider's own words, optional. */
  message: string
}): InviteContent {
  const greeting = options.firstName?.trim() ? `Hi ${options.firstName.trim()},` : 'Hello,'
  const note = options.message.trim()

  const text = [
    greeting,
    note ||
      'Your provider has asked you to book a consultation so they can go over your results with you.',
    `Consultation type: ${options.eventTypeName}`,
    `Book here: ${options.bookingUrl}`,
    'This link is for you alone and works once, so it stops working after you book.',
    `Questions? Reply to this email or write to ${SUPPORT_EMAIL}.`,
    'The AlphaMD Team',
  ].join('\n\n')

  return { subject: INVITE_SUBJECT, text, html: htmlBody(greeting, note, options) }
}

function htmlBody(
  greeting: string,
  note: string,
  options: { bookingUrl: string; eventTypeName: string }
): string {
  const intro =
    note ||
    'Your provider has asked you to book a consultation so they can go over your results with you.'

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <tr><td>
        <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#71717a;">AlphaMD</p>
        <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;">Schedule your consultation</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(greeting)}</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(intro)}</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;"><strong>Consultation type:</strong> ${escapeHtml(
          options.eventTypeName
        )}</p>
        <p style="margin:0 0 24px;">
          <a href="${escapeAttribute(options.bookingUrl)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:600;">Book my consultation</a>
        </p>
        <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#71717a;">This link is for you alone and works once, so it stops working after you book.</p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#71717a;">Questions? Reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}" style="color:#18181b;">${SUPPORT_EMAIL}</a>.</p>
      </td></tr>
    </table>
  </body>
</html>`
}

/**
 * The provider's message and the patient's own name are interpolated into HTML, so
 * both are escaped. Neither is attacker-controlled in any realistic sense, but an
 * apostrophe or a `<` in a name should not break the email either.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br />')
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
