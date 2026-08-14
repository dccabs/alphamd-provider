// Explicit `.ts` specifiers: this module is exercised by `npm test`, which runs
// TypeScript through Node's type stripping and needs the real extension. See the
// note on `allowImportingTsExtensions` in tsconfig.json.
import { FLAG, PATIENT_STATUS } from './clinicalIds.ts'
import { DISPOSITION_LABELS, FOLLOW_UP_LABELS, type ReviewDraft } from './reviewDraft.ts'

/**
 * What finishing a lab review means, decided as a pure function.
 *
 * Completion is the highest-risk write in the portal: it clears a flag, may add
 * others, may change the patient's status, and writes a note onto the chart. So
 * the *decision* about which of those apply is separated from the *doing* of them
 * and unit-tested here, where every disposition can be checked without touching
 * the database.
 *
 * This reproduces what the main app's now-frozen
 * `PATCH /api/admin/lab-reviews/[id]/status` did on finish — clear "Needs lab
 * review", optionally add "Labs reviewed, no changes recommended", write a plain
 * text note to `patient_notes_private` — and extends it with the disposition the
 * doc asks for. The note is deliberately plain text, matching every other
 * server-side note writer: HTML is never built from provider free text.
 */

export type CompletionPlan = {
  /** One line for `lab_reviews.resolution`, which the queue already displays. */
  resolution: string
  /** The chart note body. Plain text. */
  note: string
  /** The structured half, for `lab_reviews.disposition_detail`. */
  detail: Record<string, unknown>
  addFlagIds: number[]
  /** Deleted, not deactivated — matching the main app. The flag carries no
   *  history; `lab_reviews` is the record. */
  removeFlagIds: number[]
  /** `user_list.status`, or null to leave it alone. */
  patientStatusId: number | null
}

/**
 * Structural problems that must be fixed before a review can be finished.
 *
 * These check that the record will be *coherent*, not that the clinician made a
 * good decision. A dose change with no medication named, or a follow-up with
 * nothing to follow up on, is a record nobody can act on later.
 */
export function validateCompletion(draft: ReviewDraft): string[] {
  const problems: string[] = []

  if (!draft.disposition) {
    problems.push('Choose a disposition before finishing.')
    // Everything below is disposition-specific, so there is nothing else to say.
    return problems
  }

  if (draft.disposition === 'dose_change') {
    if (!draft.doseMedication.trim()) problems.push('Choose the medication being changed.')
    if (!draft.doseValue.trim()) problems.push('Enter the new dose.')
  }

  if (draft.disposition === 'follow_up_needed') {
    if (draft.followUpKinds.length === 0) {
      problems.push('Say what the follow-up needs.')
    }
    if (draft.followUpKinds.includes('patient_instructions') && !draft.instructions.trim()) {
      problems.push('Enter the instructions for the patient.')
    }
    if (
      draft.followUpKinds.includes('new_medication') &&
      !draft.newMedications.some((m) => m.name.trim())
    ) {
      problems.push('Add one under New medications, or untick "Add a new medication".')
    }
  }

  return problems
}

function namedMedications(draft: ReviewDraft) {
  return draft.newMedications.filter((m) => m.name.trim())
}

/**
 * The two sentences a dose change becomes: one for the chart, one for whoever
 * has to act on it.
 *
 * Both are composed here rather than at each call site because the confirm
 * dialog shows the provider exactly these strings before they commit. If the
 * preview and the record came from two different pieces of code they would
 * eventually disagree, and the thing that disagreed would be a prescription.
 *
 * Returns null when there is no change to describe, so callers can drop the
 * lines rather than emit a header with nothing under it.
 */
export function doseChangeLines(change: {
  medication: string
  from: string
  value: string
  sig: string
}): { chart: string; cs: string } | null {
  const medication = change.medication.trim()
  const value = change.value.trim()
  if (!medication || !value) return null

  const sig = change.sig.trim()

  // A route or a schedule can change while the weekly dose stays put. Saying
  // "160mg/week (was 160mg/week)" would read as an error; what actually changed
  // is in the instruction.
  const previous = change.from.trim()
  const from = previous === value ? '' : previous

  return {
    chart: [
      `Dose change: ${medication} — ${value}`,
      from ? ` (was ${from})` : '',
      sig ? `. ${sig}` : '',
    ].join(''),
    // Written for a reader who is not a clinician: what changed, and what they
    // have to do about it.
    cs: [
      `Dose change — ${medication}: ${sentence(from ? `${from} → ${value}` : value)}`,
      sig ? `New sig: ${sig}` : null,
      'Update the prescription and the next shipment.',
    ]
      .filter(Boolean)
      .join(' '),
  }
}

/**
 * The two sentences adding a medication becomes.
 *
 * The shape of `doseChangeLines`, for the same reason: the dialog previews these
 * exact strings, and a preview composed anywhere but here would eventually
 * disagree with the record.
 *
 * A medication with no dose still returns lines. It can only come from a draft
 * saved before the picker existed, and dropping it would lose a decision the
 * provider made.
 */
export function newMedicationLines(med: {
  name: string
  dose: string
  sig: string
}): { chart: string; cs: string } | null {
  const name = med.name.trim()
  if (!name) return null

  const dose = med.dose.trim()
  const sig = med.sig.trim()

  return {
    chart: sentence(
      [`New medication: ${name}`, dose ? ` — ${sentence(dose)}` : '', sig ? ` ${sentence(sig)}` : ''].join('')
    ),
    cs: [
      dose ? `New medication — ${name}: ${sentence(dose)}` : `New medication — ${name}.`,
      sig ? `Sig: ${sentence(sig)}` : null,
      'Add it to the prescription and the next shipment.',
    ]
      .filter(Boolean)
      .join(' '),
  }
}

/** A clause ended with exactly one full stop. Catalog doses are whole sentences
 *  and bring their own — `1.00mg - Take 1/2 tablet (0.50mg) by mouth twice
 *  weekly.` — while a dose level like `160mg/week` does not. */
function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`
}

function doseChangeFor(draft: ReviewDraft) {
  return draft.disposition === 'dose_change'
    ? doseChangeLines({
        medication: draft.doseMedication,
        from: draft.doseFrom,
        value: draft.doseValue,
        sig: draft.doseSig,
      })
    : null
}

export function planCompletion(draft: ReviewDraft, providerName: string): CompletionPlan {
  const disposition = draft.disposition
  if (!disposition) {
    throw new Error('planCompletion called without a disposition; validate first')
  }

  const label = DISPOSITION_LABELS[disposition]
  const meds = namedMedications(draft)

  // Every completion clears "Needs lab review" — that is what completing means.
  const removeFlagIds = [FLAG.needsLabReview]
  const addFlagIds: number[] = []
  let patientStatusId: number | null = null

  switch (disposition) {
    case 'continue_protocol':
      // The only disposition where "no changes recommended" is a true statement.
      addFlagIds.push(FLAG.labsReviewedNoChanges)
      break

    case 'dose_change':
    case 'follow_up_needed':
      // Somebody downstream has to act — update a prescription, order labs, relay
      // instructions. The flag is what makes that visible outside this review.
      addFlagIds.push(FLAG.followUpRequired)
      break

    case 'treatment_not_recommended':
      patientStatusId = PATIENT_STATUS.treatmentNotRecommended
      break

    case 'treatment_recommended':
      // Deliberately *not* set to "Pricing sent to PT". Recommending treatment is
      // not the same as having sent pricing, and the pricing tool does not live
      // here yet — moving the patient to status 25 would assert something that has
      // not happened. The follow-up flag is what gets pricing sent.
      addFlagIds.push(FLAG.followUpRequired)
      break
  }

  const lines: string[] = [`Lab review completed by ${providerName}. Disposition: ${label}.`]
  const dose = doseChangeFor(draft)
  // One line per medication rather than one line listing them, because each
  // carries a dose and a sig that somebody has to read and act on separately.
  const added = meds.map(newMedicationLines).filter((added) => added !== null)

  if (dose) lines.push(dose.chart)

  if (disposition === 'follow_up_needed' && draft.followUpKinds.length) {
    lines.push(
      `Follow-up needed: ${draft.followUpKinds.map((k) => FOLLOW_UP_LABELS[k]).join(', ')}`
    )
  }

  if (draft.instructions.trim()) {
    lines.push(`Patient instructions: ${draft.instructions.trim()}`)
  }

  for (const medication of added) lines.push(medication.chart)

  if (draft.concerns.trim()) lines.push(`Areas of concern: ${draft.concerns.trim()}`)

  // A dose change and an added medication lead the customer service block whether
  // or not the provider typed anything, because somebody downstream has to update
  // a prescription and the chart note is where they read what to do. Composed
  // rather than appended into the provider's own text, so changing the dose twice
  // cannot leave a stale instruction behind.
  const csLines = [
    dose?.cs,
    ...added.map((medication) => medication.cs),
    draft.csInstructions.trim() || null,
  ].filter(Boolean)
  if (csLines.length) lines.push(`For customer service: ${csLines.join('\n')}`)

  if (draft.providerNote.trim()) lines.push(draft.providerNote.trim())

  return {
    resolution: resolutionLine(draft, label),
    note: lines.join('\n'),
    detail: {
      disposition,
      followUpKinds: draft.followUpKinds,
      doseMedicationId: draft.doseMedicationId,
      doseMedication: draft.doseMedication.trim() || null,
      doseFrom: draft.doseFrom.trim() || null,
      doseValue: draft.doseValue.trim() || null,
      doseSig: draft.doseSig.trim() || null,
      newMedications: meds.map((m) => ({
        medicationId: m.medicationId,
        name: m.name.trim(),
        dose: m.dose.trim(),
        sig: m.sig.trim() || null,
      })),
      instructions: draft.instructions.trim() || null,
      concerns: draft.concerns.trim() || null,
      csInstructions: draft.csInstructions.trim() || null,
    },
    addFlagIds,
    removeFlagIds,
    patientStatusId,
  }
}

/**
 * `resolution` predates the structured disposition and is still what the queue
 * shows, so it stays a single readable line. The most specific thing available
 * goes after the label — a dose is more use at a glance than the label alone.
 */
function resolutionLine(draft: ReviewDraft, label: string): string {
  if (draft.disposition === 'dose_change' && draft.doseMedication.trim()) {
    return `${label}: ${draft.doseMedication.trim()} — ${draft.doseValue.trim()}`
  }

  if (draft.disposition === 'follow_up_needed' && draft.followUpKinds.length) {
    return `${label}: ${draft.followUpKinds.map((k) => FOLLOW_UP_LABELS[k]).join(', ')}`
  }

  const firstLine = draft.providerNote.trim().split('\n')[0]?.trim()
  return firstLine ? `${label}: ${firstLine}` : label
}
