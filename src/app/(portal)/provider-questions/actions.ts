'use server'

import { revalidatePath } from 'next/cache'

import { writeQuestionRecap } from '@/lib/ai/questionRecap'
import { checkProviderAccess } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { cancelScheduledLabOrder } from '@/lib/labOrders/mutations'
import { parseAnswerDraft } from '@/lib/providerQuestions/answerDraft'
import { signProviderQuestionAttachment } from '@/lib/providerQuestions/attachments'
import {
  finishProviderQuestion,
  saveAnswerDraft,
  type FinishSendResult,
} from '@/lib/providerQuestions/finishSend'
import { setProviderQuestionUrgent, takeProviderQuestion } from '@/lib/providerQuestions/mutations'
import type { WriteState } from '@/app/(portal)/lab-reviews/state'

/**
 * Server actions for the Provider Question pile. Every one re-checks access:
 * a server action is a public HTTP endpoint, so the page guard does not cover
 * it. A denial is returned, not thrown — see `lab-reviews/actions.ts`.
 */

const DENIED = 'Your session has expired. Reload the page and sign in again.'

/** Everything a pile write touches: the row's screen, the pile, the dashboard. */
function revalidateQuestion(id: string) {
  revalidatePath(`/provider-questions/${id}`)
  revalidatePath('/provider-questions')
  revalidatePath('/')
}

/**
 * The patient-facing restatement of a question, for the Finish preview. Read
 * from the row, not taken from the browser, so only the stored question is
 * ever sent to the model.
 */
export async function questionRecapAction(
  id: string
): Promise<{ ok: true; recap: string } | { ok: false; error: string }> {
  const access = await checkProviderAccess()
  if (!access.ok) return { ok: false, error: DENIED }

  const { data, error } = await createAdminClient()
    .from('provider_questions')
    .select('question')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return { ok: false, error: 'Could not load this Provider Question.' }

  return { ok: true, recap: await writeQuestionRecap((data.question as string | null) ?? '') }
}

/** Take-to-self: queued or someone else's in-progress row becomes mine. */
export async function takeProviderQuestionAction(id: string): Promise<WriteState> {
  const access = await checkProviderAccess()
  if (!access.ok) return { status: 'error', message: DENIED }

  const result = await takeProviderQuestion(access.access, id)
  if (!result.ok) return { status: 'error', message: result.error }

  revalidateQuestion(id)
  return { status: 'ok', warning: result.warning }
}

export async function setUrgentAction(id: string, urgent: boolean): Promise<WriteState> {
  const access = await checkProviderAccess()
  if (!access.ok) return { status: 'error', message: DENIED }

  const result = await setProviderQuestionUrgent(access.access, id, Boolean(urgent))
  if (!result.ok) return { status: 'error', message: result.error }

  revalidateQuestion(id)
  return { status: 'ok', warning: result.warning }
}

/**
 * Cancel a scheduled lab order placed from this question. The Lab Review
 * action would revalidate `/lab-reviews/{id}`, which is not where this row
 * lives, so the question pile has its own.
 */
export async function cancelLabOrderAction(
  id: string,
  scheduledId: string
): Promise<WriteState> {
  const access = await checkProviderAccess()
  if (!access.ok) return { status: 'error', message: DENIED }

  const result = await cancelScheduledLabOrder(access.access, id, scheduledId)
  if (!result.ok) return { status: 'error', message: result.error }

  revalidateQuestion(id)
  return { status: 'ok', warning: result.warning }
}

/** A short-lived link to one of this question's attachments. */
export async function openAttachmentAction(
  id: string,
  attachmentId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const access = await checkProviderAccess()
  if (!access.ok) return { ok: false, error: DENIED }

  const url = await signProviderQuestionAttachment(id, attachmentId)
  return url ? { ok: true, url } : { ok: false, error: 'Could not open this attachment.' }
}

/**
 * Autosave the answer flyout. Deliberately does not revalidate, like
 * `saveReviewDraftAction`: re-rendering under a provider mid-sentence would
 * fight the field they are typing in. Re-parsed server-side — a server action
 * is a public endpoint.
 */
export async function saveAnswerDraftAction(id: string, draftJson: string): Promise<WriteState> {
  const access = await checkProviderAccess()
  if (!access.ok) return { status: 'error', message: DENIED }

  let parsed: unknown
  try {
    parsed = JSON.parse(draftJson)
  } catch {
    return { status: 'error', message: 'Could not read the draft.' }
  }

  const result = await saveAnswerDraft(access.access, id, parseAnswerDraft(parsed))
  if (!result.ok) return { status: 'error', message: result.error }
  return { status: 'ok', warning: result.warning }
}

/**
 * Finish: send the answer, mark the row finished, write the note and run the
 * toolkit. The draft travels with the request because Finish can be pressed
 * between a keystroke and the autosave debounce.
 */
export async function finishProviderQuestionAction(
  id: string,
  draftJson: string
): Promise<FinishSendResult> {
  const access = await checkProviderAccess()
  if (!access.ok) return { status: 'error', message: DENIED }

  let parsed: unknown
  try {
    parsed = JSON.parse(draftJson)
  } catch {
    return { status: 'error', message: 'Could not read the answer.' }
  }

  const result = await finishProviderQuestion(access.access, id, parseAnswerDraft(parsed))
  if (result.status === 'finished') revalidateQuestion(id)
  return result
}
