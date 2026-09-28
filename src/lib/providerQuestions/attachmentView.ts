/**
 * Provider Question attachments as the review screen shows them.
 *
 * Files customer service added at create, for the provider only; the answer
 * never carries them to the patient. Written by alphamd
 * (`provider_question_attachments`). Two kinds:
 *  - `upload`: in the private `provider-question-attachments` bucket, opened
 *    through a short-lived signed link.
 *  - `zendesk`: a link to an attachment on the linked ticket. Zendesk's link
 *    opens without a Zendesk login.
 */

export type AttachmentSource = 'upload' | 'zendesk'

export type AttachmentDbRow = {
  id: string
  source: string
  file_name: string
  content_type: string | null
  size_bytes: number | null
  storage_path: string | null
  zendesk_ticket_id: string | null
  url: string | null
  created_by: string | null
  created_at: string | null
}

export type QuestionAttachment = {
  id: string
  source: AttachmentSource
  fileName: string
  contentType: string | null
  sizeBytes: number | null
  /** Where it came from: "Uploaded by …" or "From Zendesk #…". */
  mark: string
  /** Zendesk only. Uploads have no stored link; they are signed on open. */
  href: string | null
}

export function toQuestionAttachment(
  row: AttachmentDbRow,
  createdByName: string | null
): QuestionAttachment {
  const source: AttachmentSource = row.source === 'zendesk' ? 'zendesk' : 'upload'
  return {
    id: row.id,
    source,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    mark:
      source === 'zendesk'
        ? row.zendesk_ticket_id
          ? `From Zendesk #${row.zendesk_ticket_id}`
          : 'From Zendesk'
        : `Uploaded by ${createdByName || 'AlphaMD staff'}`,
    href: source === 'zendesk' ? row.url : null,
  }
}
