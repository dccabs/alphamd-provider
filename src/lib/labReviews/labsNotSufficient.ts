// Explicit `.ts` specifiers, as in `completion.ts`: this module is exercised by
// `npm test`, which runs TypeScript through Node's type stripping.
import type { ReviewDraft } from './reviewDraft.ts'

/**
 * Why a Provider could not accept a Patient's labs, and the words each reason
 * becomes on the chart and in the message to the Patient.
 *
 * The wording is fixed rather than drafted by the assistant. The Patient message
 * in particular has to stay informative and never accusatory — "we weren't able
 * to verify the report", not "your labs look altered" — and a sentence that is
 * reviewed once is the only way to promise that every time.
 *
 * **The import of `ReviewDraft` is type-only on purpose.** `reviewDraft.ts` needs
 * `parseInsufficientReasons` from here at runtime, the same pairing as
 * `reviewSteps.ts`.
 */

/** In the order they are listed, and the order they are written out in. */
export const INSUFFICIENT_REASONS = [
  'more_markers',
  'no_name',
  'no_dob',
  'too_old',
  'altered',
  'other',
] as const

export type InsufficientReason = (typeof INSUFFICIENT_REASONS)[number]

export function isInsufficientReason(value: unknown): value is InsufficientReason {
  return typeof value === 'string' && (INSUFFICIENT_REASONS as readonly string[]).includes(value)
}

/** The checkbox labels. */
export const INSUFFICIENT_REASON_LABELS: Record<InsufficientReason, string> = {
  more_markers: 'Need more markers (not enough for a thorough review for the treatment protocol)',
  no_name: 'No name',
  no_dob: 'No birthday',
  too_old: 'Labs too old (past 90 days)',
  altered: 'Labs look altered',
  other: 'Other',
}

/** For the queue row and the confirmation screen, where the long label does not fit. */
export const INSUFFICIENT_REASON_SHORT: Record<InsufficientReason, string> = {
  more_markers: 'Need more markers',
  no_name: 'No name',
  no_dob: 'No birthday',
  too_old: 'Labs too old',
  altered: 'Labs look altered',
  other: 'Other',
}

/** `other` is absent: its line is the Provider's own text. */
const CHART_LINES: Record<Exclude<InsufficientReason, 'other'>, string> = {
  more_markers: 'Panel is missing markers needed for a thorough review for the treatment protocol.',
  no_name: "Report does not show the patient's name.",
  no_dob: "Report does not show the patient's date of birth.",
  too_old: 'Collection date is more than 90 days ago.',
  altered: 'Report appears to have been altered; not accepted as submitted.',
}

/** `other` is absent: the Provider's text for it is written for the chart, and
 *  is never sent to the Patient without them rewriting it. */
const PATIENT_LINES: Record<Exclude<InsufficientReason, 'other'>, string> = {
  more_markers:
    "The panel doesn't include all of the markers your provider needs for a thorough review.",
  no_name: "The report doesn't show your name, which we need to match the results to you.",
  no_dob:
    "The report doesn't show your date of birth, which we need to confirm the results are yours.",
  too_old:
    'The results were collected more than 90 days ago, and we need labs from the last 90 days to make treatment decisions.',
  altered:
    "We weren't able to verify the report as submitted, so we need a copy that comes directly from the lab.",
}

/** Tolerant read of the stored list: unknown ids dropped, duplicates removed,
 *  and put back in listing order so the written text does not depend on the
 *  order the boxes were clicked. */
export function parseInsufficientReasons(value: unknown): InsufficientReason[] {
  if (!Array.isArray(value)) return []
  return INSUFFICIENT_REASONS.filter((reason) => value.includes(reason))
}

/** The reasons that count: none unless this is the disposition, and Other only
 *  once it says something. */
export function recordedReasons(draft: ReviewDraft): InsufficientReason[] {
  if (draft.disposition !== 'labs_not_sufficient') return []
  return draft.insufficientReasons.filter(
    (reason) => reason !== 'other' || draft.insufficientOther.trim()
  )
}

/** `No name; Labs too old; Other — handwritten`, for the queue row and the
 *  confirmation screen. Empty outside Labs not sufficient. */
export function insufficientReasonsLine(draft: ReviewDraft): string {
  return recordedReasons(draft)
    .map((reason) =>
      reason === 'other'
        ? `Other — ${draft.insufficientOther.trim()}`
        : INSUFFICIENT_REASON_SHORT[reason]
    )
    .join('; ')
}

/** The chart note the reasons prefill. Empty when there is nothing to say. */
export function insufficientChartNote(draft: ReviewDraft): string {
  const reasons = recordedReasons(draft)
  if (!reasons.length) return ''

  const lines = reasons.map((reason) =>
    reason === 'other' ? `Other: ${draft.insufficientOther.trim()}` : CHART_LINES[reason]
  )
  return ['Labs not sufficient — not accepted for review:', ...lines.map((l) => `- ${l}`)].join(
    '\n'
  )
}

/**
 * The message to the Patient the reasons prefill. Empty when there is nothing to
 * say.
 *
 * Missing markers is the one reason the Patient can fix without a new report from
 * the same lab, so it decides the closing paragraph: a lab order on its way when
 * one is staged in this review, otherwise an offer to help arrange the tests.
 * Either way they are told what was wrong with the report they sent.
 */
export function insufficientPatientMessage(
  draft: ReviewDraft,
  firstName: string | null
): string {
  const reasons = recordedReasons(draft)
  if (!reasons.length) return ''

  const lines = reasons.filter((reason) => reason !== 'other').map((r) => PATIENT_LINES[r])
  const intro =
    "Thank you for sending in your lab results. Your provider reviewed them, but we aren't able to use this report for your review yet"

  const markers = reasons.includes('more_markers')
  const next = !markers
    ? "Once you have an updated report, upload it to your account and we'll review it right away."
    : draft.labOrders.length
      ? "We've sent you a lab order for the additional tests. You'll get it by email with instructions for getting them done."
      : 'Our team can help you get the additional tests done. Just reply to this message.'

  return [
    `Hi ${firstName?.trim() || 'there'},`,
    lines.length ? `${intro}:\n\n${lines.map((l) => `- ${l}`).join('\n')}` : `${intro}.`,
    next,
    'If you have any questions, just reply to this message.',
  ].join('\n\n')
}

/**
 * Keeps the prefilled chart note and Patient message in step with the reasons,
 * without ever overwriting something the Provider wrote.
 *
 * A box is rewritten only when what the reasons produce has changed and the box
 * is empty or still holds exactly what they produced before. That test needs no
 * stored "edited" flag, so it survives a reload of the draft; and it is also what
 * clears the prefill when the Provider moves to another disposition, since the
 * text would be untrue there.
 */
export function withInsufficientPrefill(
  prev: ReviewDraft,
  next: ReviewDraft,
  firstName: string | null
): ReviewDraft {
  const out = { ...next }

  const note = [insufficientChartNote(prev), insufficientChartNote(next)]
  if (note[0] !== note[1] && (!next.providerNote.trim() || next.providerNote === note[0])) {
    out.providerNote = note[1]
  }

  const message = [
    insufficientPatientMessage(prev, firstName),
    insufficientPatientMessage(next, firstName),
  ]
  if (
    message[0] !== message[1] &&
    (!next.patientMessage.trim() || next.patientMessage === message[0])
  ) {
    out.patientMessage = message[1]
  }

  return out
}
