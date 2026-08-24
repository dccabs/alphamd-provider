// Explicit `.ts` specifiers, as in `completion.ts`: this module is exercised by
// `npm test`, which runs TypeScript through Node's type stripping.
import { consultLine } from '../consultations/request.ts'
import { orderLine } from '../labOrders/order.ts'
import type { ReviewDraft } from './reviewDraft.ts'

/**
 * The order a review is worked through, and what counts as having dealt with each
 * part of it.
 *
 * The flyout used to show every section at once, which let a provider write an
 * assessment and never notice that nothing had been said to the patient. So the
 * sections are now steps: one is open at a time, and it is settled either by
 * recording something or by saying out loud that it is not needed. Nothing is
 * inferred from silence.
 *
 * Kept pure and out of the component for two reasons. It is the same decision the
 * Finalize button is gated on, so it is worth unit-testing; and the collapsed
 * summary lines are composed from the same helpers the chart note and the
 * confirmation screen use — `orderLine`, `consultLine` — so a provider reviewing
 * a collapsed step is reading the words that will actually be recorded.
 *
 * **The import of `ReviewDraft` is type-only on purpose.** `reviewDraft.ts` needs
 * `parseSkippedSteps` from here at runtime, and erasing this side of the pair is
 * what keeps that from being a real cycle.
 */

/**
 * In the order they are worked through.
 *
 * The chart note comes before the two messages because both are written from it:
 * once the assessment exists, the patient message and the customer service
 * hand-off have something to relay. The patient message is last because it is the
 * only one addressed to the patient, and it reads best written once every other
 * decision in the review has been made.
 */
export const REVIEW_STEPS = [
  'doseChanges',
  'newMedications',
  'labOrders',
  'consultation',
  'providerNote',
  'csInstructions',
  'patientMessage',
] as const

export type ReviewStepId = (typeof REVIEW_STEPS)[number]

export function isReviewStep(value: unknown): value is ReviewStepId {
  return typeof value === 'string' && (REVIEW_STEPS as readonly string[]).includes(value)
}

export const STEP_TITLES: Record<ReviewStepId, string> = {
  doseChanges: 'Dose changes',
  newMedications: 'New medications',
  labOrders: 'Labs to order',
  consultation: 'Consultation',
  providerNote: 'Note for the chart',
  csInstructions: 'Instructions for customer service',
  patientMessage: 'Message for patient',
}

/**
 * What a skipped step says on its collapsed row.
 *
 * Worded as a decision rather than as an absence — "No labs to order", not
 * "Skipped" — because that is what it is. A provider scanning the settled rows
 * before finalizing is checking a list of things they decided, and "Skipped" on
 * seven rows tells them nothing about the review.
 */
export const STEP_SKIPPED_LABELS: Record<ReviewStepId, string> = {
  doseChanges: 'No dose changes',
  newMedications: 'No new medications',
  labOrders: 'No labs to order',
  consultation: 'No consultation',
  providerNote: 'Nothing added to the chart',
  csInstructions: 'Nothing for customer service',
  patientMessage: 'No message to the patient',
}

/** Whether the provider has recorded anything under this step. */
export function hasContent(step: ReviewStepId, draft: ReviewDraft): boolean {
  switch (step) {
    case 'doseChanges':
      return draft.doseChanges.length > 0
    case 'newMedications':
      return draft.newMedications.length > 0
    case 'labOrders':
      return draft.labOrders.length > 0
    case 'consultation':
      return draft.consultation !== null
    case 'providerNote':
      return draft.providerNote.trim().length > 0
    case 'csInstructions':
      return draft.csInstructions.trim().length > 0
    case 'patientMessage':
      return draft.patientMessage.trim().length > 0
  }
}

/**
 * Which steps this review has to work through.
 *
 * Empty until a disposition is chosen: every step below depends on it, and asking
 * for a dose change before knowing whether the patient is even on a protocol is
 * how the old all-at-once form managed to offer contradictory choices.
 *
 * A step that no longer applies but still holds something stays in the list. A
 * provider can record a dose change and then land on "Continue protocol as
 * designed", and `validateCompletion` refuses to finish in that state — so the
 * panel holding it has to remain reachable, because it is the only place it can be
 * removed.
 */
export function stepsFor(draft: ReviewDraft): ReviewStepId[] {
  if (draft.disposition === null) return []

  return REVIEW_STEPS.filter((step) => {
    if (step === 'doseChanges') {
      return draft.disposition === 'dose_change' || hasContent(step, draft)
    }
    // Continuing as designed is a statement that nothing is changing, so there is
    // nothing to add.
    if (step === 'newMedications') {
      return draft.disposition !== 'continue_protocol' || hasContent(step, draft)
    }
    return true
  })
}

/** Dealt with: either something was recorded, or it was explicitly skipped. */
export function isSettled(step: ReviewStepId, draft: ReviewDraft): boolean {
  return hasContent(step, draft) || draft.skippedSteps.includes(step)
}

/** The step the provider is on, or null when every applicable step is settled. */
export function openStep(draft: ReviewDraft): ReviewStepId | null {
  return stepsFor(draft).find((step) => !isSettled(step, draft)) ?? null
}

/**
 * The step the flyout should keep open.
 *
 * `openStep` treats any content as settled, which is right for Finalize and
 * wrong for the cursor: one character in the chart note is not a decision to
 * leave it. `pin` is where they are looking — Continue / Skip moves it, a
 * keystroke does not.
 */
export function pinnedOpenStep(
  draft: ReviewDraft,
  pin: ReviewStepId | null
): ReviewStepId | null {
  const steps = stepsFor(draft)
  if (pin && steps.includes(pin)) return pin
  return openStep(draft)
}

/**
 * Whether the review has been worked all the way through.
 *
 * Tests the disposition separately rather than leaning on `openStep`, which is
 * null both at the end and at the very beginning — before a disposition there are
 * no steps to be outstanding.
 */
export function allSettled(draft: ReviewDraft): boolean {
  return draft.disposition !== null && openStep(draft) === null
}

/** Adding a skip, without recording it twice. */
export function withSkip(draft: ReviewDraft, step: ReviewStepId): ReviewStepId[] {
  return draft.skippedSteps.includes(step) ? draft.skippedSteps : [...draft.skippedSteps, step]
}

/** Dropping a skip, for a step that has since been given content. Without this a
 *  step skipped, then filled, then emptied again would stay quietly settled. */
export function withoutSkip(draft: ReviewDraft, step: ReviewStepId): ReviewStepId[] {
  return draft.skippedSteps.filter((skipped) => skipped !== step)
}

/** Tolerant read of the stored skip list. Unknown ids are dropped rather than
 *  trusted, so a step renamed in this file cannot settle the wrong thing. */
export function parseSkippedSteps(value: unknown): ReviewStepId[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(isReviewStep))]
}

/** Long enough to identify what was recorded, short enough for one line. */
const SUMMARY_LIMIT = 90

function clamp(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > SUMMARY_LIMIT
    ? `${collapsed.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…`
    : collapsed
}

/** The first thing the provider wrote, which is what identifies the box. */
function firstLine(text: string): string {
  return clamp(text.split('\n').find((line) => line.trim()) ?? '')
}

function joined(parts: string[]): string {
  return clamp(parts.filter((part) => part.trim()).join('; '))
}

/**
 * The collapsed row's one line.
 *
 * Empty when the step holds nothing, which is the caller's cue to show
 * `STEP_SKIPPED_LABELS` instead. Composed from `orderLine` and `consultLine` so a
 * settled row and the confirmation summary describe the same order in the same
 * words.
 */
export function stepSummary(step: ReviewStepId, draft: ReviewDraft): string {
  switch (step) {
    case 'doseChanges':
      return joined(
        draft.doseChanges.map((change) =>
          [change.medication.trim(), change.value.trim()].filter(Boolean).join(' → ')
        )
      )
    case 'newMedications':
      return joined(
        draft.newMedications.map((med) =>
          [med.name.trim(), med.dose.trim()].filter(Boolean).join(' — ')
        )
      )
    case 'labOrders':
      return joined(draft.labOrders.map((order) => orderLine(order)))
    case 'consultation':
      return draft.consultation ? clamp(consultLine(draft.consultation)) : ''
    case 'providerNote':
      return firstLine(draft.providerNote)
    case 'csInstructions':
      return firstLine(draft.csInstructions)
    case 'patientMessage':
      return firstLine(draft.patientMessage)
  }
}
