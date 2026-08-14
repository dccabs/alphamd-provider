import {
  DISPOSITION_LABELS,
  FOLLOW_UP_LABELS,
  type ReviewDraft,
} from '../labReviews/reviewDraft.ts'
import { ESCALATION_TARGET_LABELS, type Escalation } from '../labReviews/needsAttention.ts'

/**
 * What the provider has decided so far, rendered for the prompt.
 *
 * The assistant reads the labs from `lab_review_reports`, but the *decision* only
 * exists in the flyout's unsaved draft. Without this the model can describe the
 * bloodwork and then guess at the plan, which is precisely the sentence a
 * clinician must not have to catch. So the structured choices are handed over as
 * the instruction, and the model's job is narrowed to writing them up.
 *
 * Pure, so the wording is testable without a database or an API key.
 */

export function describeDecision(draft: ReviewDraft): string {
  const lines: string[] = []

  if (draft.disposition) {
    lines.push(`Disposition chosen: ${DISPOSITION_LABELS[draft.disposition]}.`)
  }

  if (draft.doseMedication.trim()) {
    const from = draft.doseFrom.trim()
    const to = draft.doseValue.trim()
    // The sig comes with its own full stop, which would read as a stutter inside
    // the parenthesis this sentence ends with.
    const sig = draft.doseSig.trim().replace(/\.$/, '')

    lines.push(
      [
        `Dose change: ${draft.doseMedication.trim()}`,
        from ? ` from ${from}` : '',
        to ? ` to ${to}` : '',
        sig ? ` (${sig})` : '',
        '.',
      ].join('')
    )
  }

  if (draft.followUpKinds.length) {
    lines.push(
      `Follow-up required: ${draft.followUpKinds.map((k) => FOLLOW_UP_LABELS[k]).join(', ')}.`
    )
  }

  for (const med of draft.newMedications) {
    const name = med.name.trim()
    if (!name) continue

    const dose = med.dose.trim()
    // The sig comes with its own full stop, which would read as a stutter inside
    // the parenthesis this sentence ends with.
    const sig = med.sig.trim().replace(/\.$/, '')

    lines.push(
      [
        `Medication being added: ${name}`,
        dose ? ` at ${dose}` : '',
        sig ? ` (${sig})` : '',
        '.',
      ].join('')
    )
  }

  if (draft.instructions.trim()) {
    lines.push(`Instructions for the patient: ${draft.instructions.trim()}`)
  }

  if (draft.concerns.trim()) {
    lines.push(`Areas of concern the provider flagged: ${draft.concerns.trim()}`)
  }

  if (draft.csInstructions.trim()) {
    lines.push(`Handed to customer service: ${draft.csInstructions.trim()}`)
  }

  if (!lines.length) {
    // Said explicitly rather than left blank, so the model states the findings
    // and stops instead of inventing a plan to fill the gap.
    return 'The provider has not recorded a decision yet. Summarize the objective lab findings only, and do not state a plan.'
  }

  return `The provider has already recorded these decisions. Write them up faithfully and do not contradict or extend them:\n${lines.join('\n')}`
}

/** The same idea for an escalation: who it is going to, and why. */
export function describeEscalation(escalation: Escalation): string {
  const lines: string[] = []

  if (escalation.targets.length) {
    lines.push(
      `This is being handed to: ${escalation.targets
        .map((t) => ESCALATION_TARGET_LABELS[t])
        .join(' and ')}.`
    )
  }

  if (escalation.targets.includes('customer_service')) {
    lines.push(
      'The customer service reader is not a clinician. Describe what to arrange, ask, or relay — never what to prescribe.'
    )
  }

  return lines.join('\n')
}
