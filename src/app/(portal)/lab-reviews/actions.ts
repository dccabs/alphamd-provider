'use server'

import { checkProviderAccess } from '@/lib/authz'
import { getPdfPageCount } from '@/lib/labReviews/pdf'
import { signLabFile } from '@/lib/labReviews/storage'
import { replyToTicket } from '@/lib/zendesk'

/**
 * Server actions for the lab-review screen. Every one re-checks access first —
 * a server action is a public HTTP endpoint, so the page-level guard does not
 * cover it.
 *
 * A denial is *returned*, not thrown. The realistic way to hit it is a session
 * that expired while the page was open, and throwing there replaces the whole
 * screen with an error boundary; returning lets the viewer show a message and
 * keeps the rest of the review readable.
 */

const DENIED = 'Your session has expired. Reload the page and sign in again.'

export type SignedFile = { ok: true; url: string } | { ok: false; error: string }

/** Only lab files are reachable from this screen. Refusing arbitrary paths
 *  keeps these actions from becoming a general-purpose bucket reader. */
function isLabFile(storedPath: string): boolean {
  return storedPath.startsWith('original-test-results/')
}

/** Mint a short-lived signed URL for a stored lab file. */
export async function signFileAction(storedPath: string): Promise<SignedFile> {
  const access = await checkProviderAccess()
  if (!access.ok) return { ok: false, error: DENIED }

  if (!isLabFile(storedPath)) {
    return { ok: false, error: 'That file is not a lab document.' }
  }

  const url = await signLabFile(storedPath)
  return url ? { ok: true, url } : { ok: false, error: 'Could not open this file.' }
}

/**
 * A PDF's page total, or null when it cannot be determined.
 *
 * Separate from `signFileAction` so the viewer can show the document straight
 * away: reading the file to count its pages takes a few hundred milliseconds
 * and the page number is legible without a total in the meantime.
 */
export async function pdfPageCountAction(storedPath: string): Promise<number | null> {
  const access = await checkProviderAccess()
  if (!access.ok || !isLabFile(storedPath)) return null

  return getPdfPageCount(storedPath)
}

export type ReplyState = {
  status: 'idle' | 'sent' | 'error'
  message?: string
  /** Sent successfully, but Zendesk stored it privately — the patient will not
   *  see it. Surfaced rather than reported as plain success. */
  warning?: string
  /** Echoed back so the thread can show it immediately: the mirror table is
   *  written by a webhook Zendesk fires at alphamd, which this app does not
   *  own, so the row does not exist yet. */
  sentBody?: string
}

export async function sendCsReplyAction(
  _prev: ReplyState,
  formData: FormData
): Promise<ReplyState> {
  const access = await checkProviderAccess()
  if (!access.ok) return { status: 'error', message: DENIED }

  const ticketId = String(formData.get('ticketId') ?? '')
  const body = String(formData.get('body') ?? '').trim()

  if (!body) return { status: 'error', message: 'Type a message first.' }
  if (!ticketId) return { status: 'error', message: 'This patient has no Zendesk thread yet.' }

  const result = await replyToTicket({ ticketId, body, authorEmail: access.access.email })

  if (!result.ok) return { status: 'error', message: result.error }
  return { status: 'sent', warning: result.warning, sentBody: body }
}
