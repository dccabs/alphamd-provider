import { consultLine } from '../consultations/request.ts'
import { orderLine } from '../labOrders/order.ts'
import { DISPOSITION_LABELS, type ReviewDraft } from '../labReviews/reviewDraft.ts'
import { ESCALATION_TARGET_LABELS, type Escalation } from '../labReviews/needsAttention.ts'
import type { ReviewField } from './reviewFields.ts'

/**
 * What the provider has decided so far, rendered a line at a time.
 *
 * This is the *only* material a field draft is given: the decision exists nowhere
 * but the flyout's unsaved draft, and nothing about the patient is sent alongside
 * it. Every line here is therefore something the provider themselves entered,
 * which is what makes it safe to let the assistant treat these as facts.
 *
 * It is also shown to the provider verbatim in the assist modal, so it is written
 * as readable sentences rather than as prompt scaffolding, and it comes back empty
 * — not with a fallback sentence — when nothing has been recorded.
 *
 * Pure, so the wording is testable without a database or an API key.
 */

export function describeDecision(
  draft: ReviewDraft,
  /** The field being drafted, whose own text is left out: handing a field back to
   *  the model as context for itself invites it to be quoted rather than
   *  rewritten. */
  { omit }: { omit?: ReviewField } = {}
): string {
  const lines: string[] = []

  if (draft.disposition) {
    lines.push(`Disposition chosen: ${DISPOSITION_LABELS[draft.disposition]}.`)
  }

  // One sentence per prescription. A model handed "testosterone and anastrozole
  // were changed" writes one plan for two doses.
  for (const change of draft.doseChanges) {
    const medication = change.medication.trim()
    if (!medication) continue

    const from = change.from.trim()
    const to = change.value.trim()
    // The sig comes with its own full stop, which would read as a stutter inside
    // the parenthesis this sentence ends with.
    const sig = change.sig.trim().replace(/\.$/, '')

    lines.push(
      [
        `Dose change: ${medication}`,
        from ? ` from ${from}` : '',
        to ? ` to ${to}` : '',
        sig ? ` (${sig})` : '',
        '.',
      ].join('')
    )
  }

  // The one recorded decision the patient acts on themselves, so a message
  // written for them can say the draw is coming and roughly when.
  for (const order of draft.labOrders) {
    lines.push(`Labs being ordered — ${orderLine(order)}.`)
  }

  // The other thing the patient has to do something about. Worth a line for the
  // same reason: a message that does not mention the booking link leaves them to
  // work out why one arrived.
  if (draft.consultation) {
    lines.push(
      `The patient is being emailed a link to book a consultation — ${consultLine(draft.consultation)}.`
    )
    // The booking link and the sentence explaining it are appended to the patient's
    // message automatically, so a draft that writes its own booking instructions
    // produces two of them, one of which has no link under it.
    lines.push(
      'How to book, and the link itself, are added to the end of the message to the patient automatically. Do not write booking instructions or a link.'
    )
    if (draft.consultation.message.trim()) {
      lines.push(`Said to the patient in that invitation: ${draft.consultation.message.trim()}`)
    }
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

  if (omit !== 'patientMessage' && draft.patientMessage.trim()) {
    lines.push(`The message being sent to the patient: ${draft.patientMessage.trim()}`)
  }

  if (omit !== 'csInstructions' && draft.csInstructions.trim()) {
    lines.push(`Handed to customer service: ${draft.csInstructions.trim()}`)
  }

  if (omit !== 'providerNote' && draft.providerNote.trim()) {
    lines.push(`The provider's own note for the chart: ${draft.providerNote.trim()}`)
  }

  return lines.join('\n')
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
