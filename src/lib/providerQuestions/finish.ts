// Explicit `.ts` specifiers: exercised by `npm test` through Node's type stripping.
import { consultLine } from '../consultations/request.ts'
import { orderLine } from '../labOrders/order.ts'
import { FLAG } from '../labReviews/clinicalIds.ts'
import { doseChangeLines } from '../labReviews/completion.ts'
import { BASELINE_CS_GROUP_ID } from '../labReviews/patientTicket.ts'
import type { AnswerDraft } from './answerDraft.ts'

/**
 * Finishing a Provider Question, decided as pure functions.
 *
 * Finishing **is** answering: the one required thing is the patient message.
 * There is no disposition. The rest is the optional Lab Review toolkit, and
 * the same strings that are previewed are the ones that get written — see
 * `labReviews/completion.ts` for why that rule exists.
 */

/** Patient-facing — Zendesk uses this as the email subject of a new ticket. */
export const ANSWER_TICKET_SUBJECT = 'A reply from your provider'

/** Same customer support group as the Lab Review patient ticket. */
export const ANSWER_TICKET_GROUP_ID = BASELINE_CS_GROUP_ID

export const ANSWER_TICKET_STATUS = 'pending' as const

export function validateFinish(draft: AnswerDraft): string[] {
  const problems: string[] = []

  if (!draft.patientMessage.trim()) {
    problems.push(
      'Write the message to the patient. Finishing a Provider Question is answering it.'
    )
  }

  for (const change of draft.doseChanges) {
    const hasMed = change.medication.trim().length > 0
    const hasValue = change.value.trim().length > 0
    if (hasMed !== hasValue) {
      problems.push(
        hasMed
          ? `Enter the new dose for ${change.medication.trim()}, or remove the dose change.`
          : 'A dose change names no medication. Pick one, or remove it.'
      )
    }
  }

  return problems
}

export type AnswerDelivery =
  | { kind: 'reply'; ticketId: string; body: string }
  | {
      kind: 'new-ticket'
      subject: typeof ANSWER_TICKET_SUBJECT
      status: typeof ANSWER_TICKET_STATUS
      groupId: typeof ANSWER_TICKET_GROUP_ID
      body: string
    }

/**
 * Where the answer goes.
 *
 * A linked ticket gets the answer as a reply, verbatim, because the patient's
 * own question is already in that thread. No ticket — or a reply that could not
 * post — gets a new ticket written as a whole letter, so the words make sense
 * arriving cold. The letter restates the question only through `questionRecap`
 * (see `questionRecap.ts`); the staff-written question text never goes in.
 */
export function planAnswerDelivery(input: {
  ticketId: string | null
  answer: string
  firstName?: string | null
  questionRecap?: string
  replyFailed?: boolean
}): AnswerDelivery {
  const answer = input.answer.trim()
  const ticketId = input.ticketId?.trim() || null

  if (ticketId && !input.replyFailed) return { kind: 'reply', ticketId, body: answer }

  const recap = input.questionRecap?.trim()
  return {
    kind: 'new-ticket',
    subject: ANSWER_TICKET_SUBJECT,
    status: ANSWER_TICKET_STATUS,
    groupId: ANSWER_TICKET_GROUP_ID,
    body: [
      `Hi ${input.firstName?.trim() || 'there'},`,
      ...(recap ? ['We received your question:', recap] : ['We received your question.']),
      'Provider answer:',
      answer,
      'Please reply to this message if you have more questions or concerns.',
      'Thank you,\nAlphaMD Support',
    ].join('\n\n'),
  }
}

export type FinishPlan = {
  /** The Provider Question Note, exactly as it will be written to the chart. */
  note: string
  /** Structured facts the AI chart summary is written from. */
  events: string
  /**
   * Patient Flags for customer service, with what to do on each flag's note. A
   * Provider Question never creates an Action, the same as a Lab Review.
   */
  addFlagIds: number[]
  flagNotes: Partial<Record<number, string>>
  /** One line for the pile's Finished tab. */
  resolution: string
}

function recordedChanges(draft: AnswerDraft) {
  return draft.doseChanges.filter((c) => c.medication.trim() && c.value.trim())
}

function actionLines(draft: AnswerDraft): string[] {
  const lines = draft.labOrders.map((order) => `Labs ordered: ${orderLine(order)}`)
  if (draft.consultation) lines.push(`Consultation requested: ${consultLine(draft.consultation)}`)
  return lines
}

/**
 * The block customer service reads, for the audit events. A dose change leads it
 * whether or not the provider typed anything: somebody downstream has to update
 * the prescription. Empty when nobody has to act.
 */
function customerServiceBlock(draft: AnswerDraft): string {
  return [...doseChangeCsLines(draft), draft.csInstructions.trim() || null]
    .filter(Boolean)
    .join('\n')
}

function doseChangeCsLines(draft: AnswerDraft): string[] {
  return recordedChanges(draft)
    .map(doseChangeLines)
    .filter((c) => c !== null)
    .map((c) => c.cs)
}

/**
 * Follow Up Required means CS has something to do, and its note says what; a
 * dose change adds Dose Change with the instruction. Labs, a consultation or the
 * answer alone reach the Patient directly. Same rule as `planCompletion`.
 */
function flagsFor(draft: AnswerDraft): Pick<FinishPlan, 'addFlagIds' | 'flagNotes'> {
  const addFlagIds: number[] = []
  const flagNotes: Partial<Record<number, string>> = {}
  const doseLines = doseChangeCsLines(draft)
  const request = draft.csInstructions.trim()

  if (doseLines.length || request) {
    addFlagIds.push(FLAG.followUpRequired)
    flagNotes[FLAG.followUpRequired] = request || 'Dose change — see the Dose Change flag.'
  }
  if (doseLines.length) {
    addFlagIds.push(FLAG.doseChange)
    flagNotes[FLAG.doseChange] = doseLines.join('\n')
  }
  return { addFlagIds, flagNotes }
}

export function planFinish(input: {
  question: string
  csComments: string | null
  draft: AnswerDraft
  providerName: string
}): FinishPlan {
  const { draft, providerName } = input
  const question = input.question.trim()
  const answer = draft.patientMessage.trim()
  const changes = recordedChanges(draft)
    .map(doseChangeLines)
    .filter((c) => c !== null)

  const lead = `Provider Question answered by ${providerName}.`

  const events = [
    lead,
    `Question: ${question}`,
    input.csComments?.trim() ? `Customer service context: ${input.csComments.trim()}` : null,
    `Answer sent to the patient: ${answer}`,
    ...changes.map((c) => c.chart),
    ...actionLines(draft),
    customerServiceBlock(draft) ? `For customer service: ${customerServiceBlock(draft)}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const note = [
    draft.chartSummary.trim() || lead,
    `Question: ${question}\n\nAnswer: ${answer}`,
    ...changes.map((c) => c.chart),
    ...actionLines(draft),
  ]
    .filter(Boolean)
    .join('\n\n')

  return { note, events, ...flagsFor(draft), resolution: resolutionLine(draft) }
}

function resolutionLine(draft: AnswerDraft): string {
  const changes = recordedChanges(draft)
  if (changes.length) {
    return `Answered; dose change — ${changes
      .map((c) => `${c.medication.trim()} ${c.value.trim()}`)
      .join('; ')}`
  }
  if (draft.labOrders.length) return 'Answered; labs ordered'
  if (draft.consultation) return 'Answered; consultation requested'
  if (draft.csInstructions.trim()) return 'Answered; customer service asked'
  return 'Answered'
}

/**
 * The provider's other entries, for the AI field draft's "recorded" context.
 * The counterpart of `describeDecision` for a Lab Review.
 */
export function describeAnswer(
  draft: AnswerDraft,
  question: string,
  options: { omit?: 'patientMessage' | 'csInstructions' } = {}
): string {
  const lines = [`The patient asked: ${question.trim()}`]

  for (const c of recordedChanges(draft)) {
    const line = doseChangeLines(c)
    if (line) lines.push(line.chart)
  }
  lines.push(...actionLines(draft))
  if (options.omit !== 'patientMessage' && draft.patientMessage.trim()) {
    lines.push(`Message to the patient: ${draft.patientMessage.trim()}`)
  }
  if (options.omit !== 'csInstructions' && draft.csInstructions.trim()) {
    lines.push(`Instructions for customer service: ${draft.csInstructions.trim()}`)
  }

  return lines.join('\n')
}
