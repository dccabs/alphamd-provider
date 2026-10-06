import 'server-only'

import { contactsFor } from '@/lib/labReviews/queries'
import { createAdminClient } from '@/lib/supabase/admin'
import { toQuestionAttachment, type AttachmentDbRow, type QuestionAttachment } from './attachmentView'

/**
 * Reads and signing for Provider Question attachments. Service role, like the
 * rest of `providerQuestions/`: callers must run `checkProviderAccess()` first.
 */

export const ATTACHMENT_BUCKET = 'provider-question-attachments'

const SELECT =
  'id, source, file_name, content_type, size_bytes, storage_path, zendesk_ticket_id, url, created_by, created_at'

/** Oldest first, in the order customer service added them. */
export async function listProviderQuestionAttachments(
  providerQuestionId: string
): Promise<QuestionAttachment[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('provider_question_attachments')
    .select(SELECT)
    .eq('provider_question_id', providerQuestionId)
    .order('created_at', { ascending: true })
  // Missing attachments are worth losing; the review screen is not.
  if (error) {
    console.error('Failed to load Provider Question attachments', { message: error.message })
    return []
  }

  const rows = (data ?? []) as AttachmentDbRow[]
  const creators = await contactsFor(
    rows.map((r) => r.created_by).filter(Boolean) as string[],
    ''
  ).catch(() => new Map<string, { name: string }>())
  return rows.map((row) =>
    toQuestionAttachment(row, row.created_by ? creators.get(row.created_by)?.name || null : null)
  )
}

/** A short-lived link to one attachment on this question, or null. */
export async function signProviderQuestionAttachment(
  providerQuestionId: string,
  attachmentId: string
): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('provider_question_attachments')
    .select('source, storage_path, url')
    .eq('id', attachmentId)
    .eq('provider_question_id', providerQuestionId)
    .maybeSingle()
  if (error || !data) return null

  if (data.source === 'zendesk') return (data.url as string | null) ?? null

  const path = data.storage_path as string | null
  if (!path) return null
  const signed = await admin.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, 300)
  if (signed.error) {
    console.error('Failed to sign Provider Question attachment', {
      attachmentId,
      message: signed.error.message,
    })
    return null
  }
  return signed.data?.signedUrl ?? null
}
