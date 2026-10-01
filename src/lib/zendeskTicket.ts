/**
 * The body of `POST /api/v2/tickets.json` for a message we send to a patient.
 *
 * Zendesk makes the ticket's submitter the author of its first comment, and
 * when a ticket is created with a `requester` but no `submitter_id` the
 * submitter defaults to that requester. Left out, the provider's message
 * reaches the patient as if the patient had written it. So the author is named
 * twice: as the submitter, and on the comment.
 */
export function newTicketPayload(input: {
  subject: string
  htmlBody: string
  requester: { name: string; email: string }
  status: string
  groupId: number
  /** The provider, or the service account. Null only when neither is known. */
  authorId: number | null
}) {
  const { subject, htmlBody, requester, status, groupId, authorId } = input
  return {
    ticket: {
      subject,
      requester,
      status,
      group_id: groupId,
      ...(authorId ? { submitter_id: authorId } : {}),
      comment: {
        html_body: htmlBody,
        public: true as const,
        ...(authorId ? { author_id: authorId } : {}),
      },
    },
  }
}
