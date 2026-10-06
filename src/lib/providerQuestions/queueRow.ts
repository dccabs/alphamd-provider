/**
 * A row of the Provider Question pile, and what it says about the question.
 *
 * Provider Question is a sibling of Lab Review: the provider-queue row for a
 * patient medical question. Many per patient. Pure, like `labReviews/queueRow`,
 * so Aged and the meta line can be tested directly. Glossary: CONTEXT.md in
 * alphamd → Provider Questions.
 */

import { relativeAge, shortDate } from '../labReviews/format.ts'

export const PROVIDER_QUESTION_STATUSES = ['queued', 'in_progress', 'finished'] as const
export type ProviderQuestionStatus = (typeof PROVIDER_QUESTION_STATUSES)[number]

export function isProviderQuestionStatus(
  value: string | undefined
): value is ProviderQuestionStatus {
  return !!value && (PROVIDER_QUESTION_STATUSES as readonly string[]).includes(value)
}

export type ProviderQuestionRow = {
  id: string
  patientId: string
  patientName: string
  patientEmail: string | null
  patientStatus: string | null
  /** Who usually owns the protocol. Not the Question Assignee. */
  prescribingProviderName: string | null
  status: ProviderQuestionStatus
  question: string
  csComments: string | null
  urgent: boolean
  /** Question Assignee. */
  assignedTo: string | null
  assignedToName: string | null
  zendeskTicketId: string | null
  createdAt: string | null
  startedAt: string | null
  finishedAt: string | null
  finishedByName: string | null
  /** One line for the Finished tab, e.g. "Answered; labs ordered". */
  resolution: string | null
  /** Open Provider Questions on this patient, this one included. */
  openCountForPatient: number
  flags: string[]
}

/** Open means not finished: queued or in progress. */
export function isOpen(row: Pick<ProviderQuestionRow, 'status'>): boolean {
  return row.status !== 'finished'
}

const WEEKDAYS_BEFORE_AGED = 2

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay()
  return day !== 0 && day !== 6
}

/**
 * Aged: an Open Provider Question whose create date is more than two weekdays
 * ago. Dates only, no hour math, no holiday calendar. Display only — no page,
 * no auto-assign. Same rule as `isAgedProviderQuestion` in alphamd.
 */
export function isAged(
  row: Pick<ProviderQuestionRow, 'status' | 'createdAt'>,
  now: Date = new Date()
): boolean {
  if (!isOpen(row) || !row.createdAt) return false

  const created = new Date(row.createdAt)
  if (Number.isNaN(created.getTime())) return false

  const cursor = new Date(
    Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate())
  )
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())

  let weekdaysPassed = 0
  while (cursor.getTime() < today) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (isWeekday(cursor)) weekdaysPassed += 1
    if (weekdaysPassed > WEEKDAYS_BEFORE_AGED) return true
  }
  return false
}

/**
 * The row's second line, as segments a caller joins with a separator.
 *
 * Order: when it was asked, who prescribes, who has it (or who finished it),
 * how long they have had it, then the many-open note.
 */
export function questionRowMeta(
  row: Pick<
    ProviderQuestionRow,
    | 'status'
    | 'createdAt'
    | 'prescribingProviderName'
    | 'assignedToName'
    | 'startedAt'
    | 'finishedAt'
    | 'finishedByName'
    | 'openCountForPatient'
  >,
  now: Date = new Date()
): string[] {
  const age = relativeAge(row.createdAt, now)
  const segments: (string | null)[] = [
    row.createdAt ? `asked ${age ? `${age} ` : ''}(${shortDate(row.createdAt)})` : null,
    row.prescribingProviderName ? `prescribing: ${row.prescribingProviderName}` : null,
  ]

  if (row.status === 'finished') {
    const when = row.finishedAt ? relativeAge(row.finishedAt, now) : null
    const by = row.finishedByName ?? row.assignedToName
    segments.push(['finished', by ? `by ${by}` : null, when].filter(Boolean).join(' '))
    return segments.filter(Boolean) as string[]
  }

  if (row.status === 'in_progress' && row.assignedToName) {
    segments.push(`${row.assignedToName} has it`)
    if (row.startedAt) segments.push(`taken ${relativeAge(row.startedAt, now)}`)
  } else {
    segments.push('queued')
  }

  if (row.openCountForPatient > 1) {
    segments.push(`${row.openCountForPatient} open for this patient`)
  }

  return segments.filter(Boolean) as string[]
}
