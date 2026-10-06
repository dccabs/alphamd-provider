import 'server-only'

import { writeQuestionRecap } from '@/lib/ai/questionRecap'
import type { ProviderAccess } from '@/lib/authz'
import { consultProblems, requestConsultation } from '@/lib/consultations/mutations'
import { labOrderProblems, scheduleLabOrder } from '@/lib/labOrders/mutations'
import { resolveActor } from '@/lib/labReviews/events'
import { DEFAULT_REPLY_IDENTITY } from '@/lib/labReviews/replyIdentity'
import { FLAG_LABELS } from '@/lib/labReviews/clinicalIds'
import { addPatientFlag } from '@/lib/patients/flags'
import { CLINIC_TIME_ZONE } from '@/lib/protocols/labels'
import { createAdminClient } from '@/lib/supabase/admin'
import { createTicket, replyToTicket } from '@/lib/zendesk'

import { isAnswerDraftEmpty, type AnswerDraft } from './answerDraft'
import { logProviderQuestionEvent } from './events'
import { planAnswerDelivery, planFinish, validateFinish } from './finish'
import { loadForMutation, type MutationResult } from './mutations'

/**
 * Finishing a Provider Question, the side-effecting half. The decisions are
 * all in `finish.ts`; this file only carries them out, in an order chosen so
 * that nothing irreversible happens before the one thing finishing means.
 *
 * Order, and why:
 *
 *   1. The answer goes to the patient. If Zendesk will not take it — reply or
 *      new ticket — the question stays in progress with the draft intact, and
 *      the provider sees why. An unanswered question must not read as finished.
 *   2. The row is marked finished. Compare-and-swap on the assignment, as
 *      `completeLabReview` does, so two tabs cannot both finish it.
 *   3. Everything else — chart note, flags, labs, consultation — is
 *      attempted independently and *reported*, never thrown. The answer has
 *      already gone out, so aborting would only hide what still needs doing by
 *      hand.
 */

export type FinishSendResult =
  | { status: 'finished'; warning?: string }
  | { status: 'error'; message: string }

/**
 * Autosave the answer flyout. Not a status change; no audit entry, like
 * `saveReviewDraft`. Refused on a finished row so a stale tab cannot rewrite
 * the record of what was sent.
 */
export async function saveAnswerDraft(
  access: ProviderAccess,
  id: string,
  draft: AnswerDraft
): Promise<MutationResult> {
  const row = await loadForMutation(id)
  if (!row) return { ok: false, error: 'This Provider Question no longer exists.' }
  if (row.status === 'finished') {
    return { ok: false, error: 'This Provider Question is already finished.' }
  }
  if (row.assignedTo !== access.userId) {
    return { ok: false, error: 'Take this question before writing an answer.' }
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { error } = await admin
    .from('provider_questions')
    .update({ draft, draft_updated_at: isAnswerDraftEmpty(draft) ? null : now, updated_at: now })
    .eq('id', id)
    .neq('status', 'finished')
  if (error) return { ok: false, error: `Could not save the draft: ${error.message}` }

  return { ok: true }
}

export async function finishProviderQuestion(
  access: ProviderAccess,
  id: string,
  draft: AnswerDraft
): Promise<FinishSendResult> {
  const row = await loadForMutation(id)
  if (!row) return { status: 'error', message: 'This Provider Question no longer exists.' }
  if (row.status === 'finished') {
    return { status: 'error', message: 'This Provider Question is already finished.' }
  }
  if (row.assignedTo !== access.userId) {
    return {
      status: 'error',
      message:
        row.status === 'queued'
          ? 'Take this question before answering it.'
          : 'Another provider has this question. Take it over before answering.',
    }
  }

  const problems = validateFinish(draft)
  if (problems.length) return { status: 'error', message: problems.join(' ') }

  // The toolkit's own refusals, checked before anything is sent: a lab order that
  // could never be placed or a consultation with no address to send to are things
  // the provider can fix now, and cannot once the answer has gone out.
  const [orderProblems, consultIssues] = await Promise.all([
    labOrderProblems(row.patientId, draft.labOrders),
    consultProblems(row.patientId, draft.consultation),
  ])
  if (orderProblems.length || consultIssues.length) {
    return { status: 'error', message: [...orderProblems, ...consultIssues].join(' ') }
  }

  const admin = createAdminClient()
  const { data: full, error: fullError } = await admin
    .from('provider_questions')
    .select('question, cs_comments, zendesk_ticket_id')
    .eq('id', id)
    .maybeSingle()
  if (fullError || !full) {
    return { status: 'error', message: 'Could not load this Provider Question.' }
  }

  const { data: patient, error: patientError } = await admin
    .from('user_list')
    .select('first_name, last_name, email')
    .eq('user_id', row.patientId)
    .maybeSingle()
  if (patientError || !patient) {
    return { status: 'error', message: 'Could not load this patient.' }
  }

  const actor = await resolveActor(access)
  const question = full.question as string
  const csComments = (full.cs_comments as string | null) ?? null
  const plan = planFinish({ question, csComments, draft, providerName: actor.displayName })
  const warnings: string[] = []

  // 1. The answer reaches the patient, or nothing else happens.
  const delivered = await deliverAnswer({
    access,
    ticketId: (full.zendesk_ticket_id as string | null) ?? null,
    question,
    answer: draft.patientMessage,
    firstName: (patient.first_name as string | null) ?? null,
    questionRecap: draft.questionRecap,
    patient: {
      name: [patient.first_name, patient.last_name].filter(Boolean).join(' ').trim(),
      email: (patient.email as string | null) ?? null,
    },
  })
  if (!delivered.ok) return { status: 'error', message: delivered.error }
  if (delivered.warning) warnings.push(delivered.warning)

  // 2. The row is finished. Urgent clears here: it is a property of Open work.
  const now = new Date().toISOString()
  const { data: updated, error: finishError } = await admin
    .from('provider_questions')
    .update({
      status: 'finished',
      urgent: false,
      answer: draft.patientMessage.trim(),
      resolution: plan.resolution,
      finished_at: now,
      finished_by: access.userId,
      zendesk_ticket_id: delivered.ticketId,
      draft,
      draft_updated_at: now,
      updated_at: now,
    })
    .eq('id', id)
    .eq('assigned_to', access.userId)
    .neq('status', 'finished')
    .select('id')
  if (finishError) {
    return {
      status: 'error',
      message: `The answer was sent to the patient, but the question could not be marked finished (${finishError.message}). Do not resend — reload and finish again.`,
    }
  }
  if (!updated?.length) {
    return {
      status: 'error',
      message:
        'The answer was sent, but this question was finished or taken by somebody else a moment ago. Do not resend — reload the page.',
    }
  }

  // 3. The record and the toolkit, each reported on its own.
  const noteId = await writeNote(admin, {
    questionId: id,
    patientId: row.patientId,
    createdBy: access.userId,
    note: plan.note,
  })
  if (noteId === null) warnings.push('the Provider Question Note could not be written to the chart')

  warnings.push(
    ...(await raiseFlags({
      questionId: id,
      patientId: row.patientId,
      staffUserId: access.userId,
      providerName: actor.displayName,
      plan,
    }))
  )

  warnings.push(...(await placeOrders(access, id, draft)))
  warnings.push(...(await sendConsult(access, id, draft)))

  const logged = await logProviderQuestionEvent({
    providerQuestionId: id,
    eventType: 'finished',
    actor,
    summary: `${actor.displayName} answered the Provider Question — ${plan.resolution}`,
    fromStatus: row.status,
    toStatus: 'finished',
    metadata: {
      events: plan.events,
      delivery: delivered.kind,
      zendeskTicketId: delivered.ticketId,
      sentAs: delivered.sentAs,
      noteId,
      addedFlagIds: plan.addFlagIds,
      flagNotes: plan.flagNotes,
      labOrdersPlaced: draft.labOrders.length,
      consultationRequested: draft.consultation?.eventTypeId ?? null,
      sideEffectWarnings: warnings,
    },
  })
  if (!logged.ok) warnings.push(`the audit log entry failed (${logged.error})`)

  if (warnings.length) {
    return {
      status: 'finished',
      warning: `Answered, but ${warnings.join('; ')}. Tell an administrator.`,
    }
  }
  return { status: 'finished' }
}

type Delivered =
  | {
      ok: true
      kind: 'reply' | 'new-ticket'
      ticketId: string
      sentAs: 'self' | 'support'
      warning?: string
    }
  | { ok: false; error: string }

/**
 * Reply on the linked ticket; fall back to a new ticket when there is none or
 * the reply is refused. The fallback body restates the question, so the two
 * paths are planned separately rather than the second reusing the first.
 *
 * A new ticket that was previewed carries the recap the provider approved. One
 * that only exists because a reply failed was never previewed as a letter, so
 * its recap is written here.
 */
async function deliverAnswer(input: {
  access: ProviderAccess
  ticketId: string | null
  question: string
  answer: string
  firstName: string | null
  questionRecap: string
  patient: { name: string; email: string | null }
}): Promise<Delivered> {
  const first = planAnswerDelivery(input)

  let replyError: string | null = null
  if (first.kind === 'reply') {
    const replied = await replyToTicket({
      ticketId: first.ticketId,
      body: first.body,
      authorEmail: input.access.email,
      as: DEFAULT_REPLY_IDENTITY,
    })
    if (replied.ok) {
      return {
        ok: true,
        kind: 'reply',
        ticketId: first.ticketId,
        sentAs: replied.sentAs,
        warning: replied.warning,
      }
    }
    replyError = replied.error
  }

  if (!input.patient.email?.trim()) {
    return {
      ok: false,
      error: replyError
        ? `The reply to ticket ${input.ticketId} failed (${replyError}) and this patient has no email address for a new ticket. Nothing was sent.`
        : 'This patient has no email address on file, so the answer cannot be sent. Nothing was sent.',
    }
  }

  const fallback = planAnswerDelivery({
    ...input,
    questionRecap:
      first.kind === 'reply' ? await writeQuestionRecap(input.question) : input.questionRecap,
    replyFailed: true,
  })
  if (fallback.kind !== 'new-ticket') {
    return { ok: false, error: 'Could not plan where to send the answer.' }
  }

  const created = await createTicket({
    subject: fallback.subject,
    body: fallback.body,
    requesterName: input.patient.name || 'AlphaMD patient',
    requesterEmail: input.patient.email,
    status: fallback.status,
    groupId: fallback.groupId,
    authorEmail: input.access.email,
    as: DEFAULT_REPLY_IDENTITY,
  })
  if (!created.ok) {
    return {
      ok: false,
      error: replyError
        ? `The reply to ticket ${input.ticketId} failed (${replyError}), and a new ticket could not be created either (${created.error}). Nothing was sent.`
        : `${created.error} Nothing was sent.`,
    }
  }

  const warnings = [
    replyError ? `the reply to ticket ${input.ticketId} failed (${replyError}), so the answer went out as a new ticket` : null,
    created.warning ?? null,
  ].filter(Boolean)

  return {
    ok: true,
    kind: 'new-ticket',
    ticketId: String(created.ticketId),
    sentAs: created.sentAs,
    warning: warnings.length ? warnings.join('; ') : undefined,
  }
}

/**
 * Raise the plan's Patient Flags, each note headed so CS can tell which question
 * it came from. Nothing is cleared: Follow Up Required and Dose Change are
 * removed by CS once the note is done, as with a Lab Review.
 */
async function raiseFlags(input: {
  questionId: string
  patientId: string
  staffUserId: string
  providerName: string
  plan: ReturnType<typeof planFinish>
}): Promise<string[]> {
  const warnings: string[] = []
  const heading = `Provider Question by ${input.providerName}, ${new Date().toLocaleDateString(
    'en-US',
    { month: 'short', day: 'numeric', timeZone: CLINIC_TIME_ZONE }
  )}`

  for (const flagId of input.plan.addFlagIds) {
    const body = input.plan.flagNotes[flagId]
    const added = await addPatientFlag(
      input.patientId,
      flagId,
      input.staffUserId,
      body ? { ref: input.questionId.slice(0, 8), heading, body } : undefined
    )
    if (!added) warnings.push(`the "${FLAG_LABELS[flagId] ?? flagId}" flag could not be added`)
  }
  return warnings
}

/**
 * The Provider Question Note. Plain text like every other server-side note
 * writer, and linked both ways: the note carries `provider_question_id` so
 * staff can click back to the Finished row, and the row carries `note_id`.
 */
async function writeNote(
  admin: ReturnType<typeof createAdminClient>,
  input: { questionId: string; patientId: string; createdBy: string; note: string }
): Promise<number | null> {
  const { data, error } = await admin
    .from('patient_notes_private')
    .insert({
      patient_id: input.patientId,
      created_by: input.createdBy,
      note: input.note,
      provider_question_id: input.questionId,
    })
    .select('id')
    .maybeSingle()
  if (error || !data?.id) return null

  const noteId = data.id as number
  await admin.from('provider_questions').update({ note_id: noteId }).eq('id', input.questionId)
  return noteId
}

/** Same reuse as `completeLabReview`: an order placed from a finished question
 *  is written exactly like one placed on its own. */
async function placeOrders(
  access: ProviderAccess,
  questionId: string,
  draft: AnswerDraft
): Promise<string[]> {
  const warnings: string[] = []
  for (const [index, order] of draft.labOrders.entries()) {
    const where = `lab order ${index + 1}`
    try {
      const result = await scheduleLabOrder(access, questionId, order)
      if (!result.ok) warnings.push(`${where} was not placed (${result.error})`)
      else if (result.warning) warnings.push(`${where} was placed but not fully recorded`)
    } catch (error) {
      warnings.push(
        `${where} was not placed (${error instanceof Error ? error.message : 'unknown error'})`
      )
    }
  }
  return warnings
}

async function sendConsult(
  access: ProviderAccess,
  questionId: string,
  draft: AnswerDraft
): Promise<string[]> {
  if (!draft.consultation) return []
  try {
    const result = await requestConsultation(access, questionId, draft.consultation)
    if (!result.ok) return [`the consultation invitation was not sent (${result.error})`]
    if (result.warning) return ['the consultation invitation was sent but not fully recorded']
    return []
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    return [`the consultation invitation was not sent (${message})`]
  }
}
