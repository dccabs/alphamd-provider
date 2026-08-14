'use server'

import { revalidatePath } from 'next/cache'

import { checkProviderAccess } from '@/lib/authz'
import { requestConsultation } from '@/lib/consultations/mutations'
import { cancelScheduledLabOrder, scheduleLabOrder } from '@/lib/labOrders/mutations'
import type { LabOrder } from '@/lib/labOrders/order'
import {
  completeLabReview,
  escalateLabReview,
  reassignLabReview,
  saveReviewDraft,
  startLabReview,
} from '@/lib/labReviews/mutations'
import { parseTargets } from '@/lib/labReviews/needsAttention'
import { getPdfPageCount } from '@/lib/labReviews/pdf'
import { parseDraft } from '@/lib/labReviews/reviewDraft'
import { signLabFile } from '@/lib/labReviews/storage'
import { isReplyIdentity, type ReplyIdentity } from '@/lib/labReviews/replyIdentity'
import { replyToTicket } from '@/lib/zendesk'
import type { ConsultState, WriteState } from './state'

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
  /** Sent successfully, but something about it needs saying — Zendesk stored it
   *  privately, or it went out as AlphaMD Support when the provider asked to
   *  send under their own name. */
  warning?: string
  /** Which identity the patient will actually see on the comment. */
  sentAs?: ReplyIdentity
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

  // An unrecognised value means a tampered or stale form. Fall back to the
  // service account, which is the identity that cannot leak a provider's name.
  const requested = String(formData.get('sendAs') ?? '')
  const as: ReplyIdentity = isReplyIdentity(requested) ? requested : 'support'

  if (!body) return { status: 'error', message: 'Type a message first.' }
  if (!ticketId) return { status: 'error', message: 'This patient has no Zendesk thread yet.' }

  const result = await replyToTicket({ ticketId, body, authorEmail: access.access.email, as })

  if (!result.ok) return { status: 'error', message: result.error }
  return { status: 'sent', warning: result.warning, sentAs: result.sentAs, sentBody: body }
}

/** Everything a lab-review write touches: the review, the queue it is ordered
 *  in, and the dashboard counts. */
function revalidateReview(reviewId: string) {
  revalidatePath(`/lab-reviews/${reviewId}`)
  revalidatePath('/lab-reviews')
  revalidatePath('/')
}

/** Claim the review, stamp the start, and let the caller open the flyout. */
export async function startLabReviewAction(reviewId: string): Promise<WriteState> {
  const access = await checkProviderAccess()
  if (!access.ok) return { status: 'error', message: DENIED }

  const result = await startLabReview(access.access, reviewId)
  if (!result.ok) return { status: 'error', message: result.error }

  revalidateReview(reviewId)
  return { status: 'ok', warning: result.warning }
}

/** Hand the review to another provider — the doc's manual handoff, as distinct
 *  from the auto-assign that happens on start. */
export async function reassignLabReviewAction(
  reviewId: string,
  toUserId: string
): Promise<WriteState> {
  const access = await checkProviderAccess()
  if (!access.ok) return { status: 'error', message: DENIED }

  if (!toUserId) return { status: 'error', message: 'Choose a provider first.' }

  const result = await reassignLabReview(access.access, reviewId, toUserId)
  if (!result.ok) return { status: 'error', message: result.error }

  revalidateReview(reviewId)
  return { status: 'ok', warning: result.warning }
}

/**
 * Autosave the flyout.
 *
 * Called on a debounce while the provider types, so it deliberately does **not**
 * revalidate: re-rendering the page under a provider mid-sentence would fight
 * the fields they are editing. The saved draft is picked up on the next real
 * navigation, which is the only time it matters.
 *
 * The draft crosses the wire as JSON rather than a `FormData`, because it is a
 * nested object and `parseDraft` has to validate it server-side anyway — a
 * server action is a public endpoint, so the shape is never trusted.
 */
export async function saveReviewDraftAction(
  reviewId: string,
  draftJson: string
): Promise<WriteState> {
  const access = await checkProviderAccess()
  if (!access.ok) return { status: 'error', message: DENIED }

  let parsed: unknown
  try {
    parsed = JSON.parse(draftJson)
  } catch {
    return { status: 'error', message: 'Could not read the draft.' }
  }

  const result = await saveReviewDraft(access.access, reviewId, parseDraft(parsed))
  if (!result.ok) return { status: 'error', message: result.error }

  return { status: 'ok', warning: result.warning }
}

/**
 * Finish the review.
 *
 * The draft travels with the request rather than being read from the column,
 * because Finalize can be pressed between a keystroke and the autosave debounce.
 * It is re-parsed and re-validated server-side: a server action is a public
 * endpoint, and this one writes to a chart.
 */
export async function completeLabReviewAction(
  reviewId: string,
  draftJson: string
): Promise<WriteState> {
  const access = await checkProviderAccess()
  if (!access.ok) return { status: 'error', message: DENIED }

  let parsed: unknown
  try {
    parsed = JSON.parse(draftJson)
  } catch {
    return { status: 'error', message: 'Could not read the review.' }
  }

  const result = await completeLabReview(access.access, reviewId, parseDraft(parsed))
  if (!result.ok) return { status: 'error', message: result.error }

  revalidateReview(reviewId)
  return { status: 'ok', warning: result.warning }
}

/**
 * Park a review as needing attention, routed to customer service, another
 * provider, or both.
 *
 * The target list is re-parsed rather than trusted, and the note is required —
 * both checks are repeated from the panel because a server action is a public
 * endpoint.
 */
export async function escalateLabReviewAction(
  reviewId: string,
  input: { targets: string[]; note: string; toProviderId: string | null }
): Promise<WriteState> {
  const access = await checkProviderAccess()
  if (!access.ok) return { status: 'error', message: DENIED }

  const result = await escalateLabReview(access.access, reviewId, {
    targets: parseTargets(input.targets),
    note: String(input.note ?? ''),
    toProviderId: input.toProviderId || null,
  })
  if (!result.ok) return { status: 'error', message: result.error }

  revalidateReview(reviewId)
  return { status: 'ok', warning: result.warning }
}

/**
 * Order labs, now or on a future date.
 *
 * The order is re-validated inside `scheduleLabOrder` against the patient's state
 * as read from the database, so nothing here trusts the shape that arrives. The
 * patient is resolved from the review rather than passed in — this writes to a
 * chart, and the review is the only trustworthy statement of whose chart it is.
 */
export async function scheduleLabOrderAction(
  reviewId: string,
  order: LabOrder
): Promise<WriteState> {
  const access = await checkProviderAccess()
  if (!access.ok) return { status: 'error', message: DENIED }

  const result = await scheduleLabOrder(access.access, reviewId, order)
  if (!result.ok) return { status: 'error', message: result.error }

  revalidateReview(reviewId)
  return { status: 'ok', warning: result.warning }
}

/** Cancel a still-pending order. */
export async function cancelLabOrderAction(
  reviewId: string,
  scheduledId: string
): Promise<WriteState> {
  const access = await checkProviderAccess()
  if (!access.ok) return { status: 'error', message: DENIED }

  const result = await cancelScheduledLabOrder(access.access, reviewId, scheduledId)
  if (!result.ok) return { status: 'error', message: result.error }

  revalidateReview(reviewId)
  return { status: 'ok', warning: result.warning }
}

/** Mint a single-use Calendly link and email it to the patient. */
export async function requestConsultationAction(
  reviewId: string,
  input: { eventTypeId: string; message: string }
): Promise<ConsultState> {
  const access = await checkProviderAccess()
  if (!access.ok) return { status: 'error', message: DENIED }

  const result = await requestConsultation(access.access, reviewId, {
    eventTypeId: String(input.eventTypeId ?? ''),
    message: String(input.message ?? ''),
  })
  if (!result.ok) return { status: 'error', message: result.error }

  revalidateReview(reviewId)
  return {
    status: 'sent',
    bookingUrl: result.bookingUrl,
    sentTo: result.sentTo,
    warning: result.warning,
  }
}
