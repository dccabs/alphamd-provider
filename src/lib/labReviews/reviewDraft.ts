// Explicit `.ts` specifier, as in `completion.ts`: this module is exercised by
// `npm test`, which runs TypeScript through Node's type stripping.
import { parseConsultRequest, type ConsultRequest } from '../consultations/request.ts'
import { parseOrders, type LabOrder } from '../labOrders/order.ts'
import { parseSkippedSteps, type ReviewStepId } from './reviewSteps.ts'

/**
 * The shape of an in-progress lab review, and the vocabulary of dispositions it
 * can land on. Pure, so the flyout can import it and it can be unit-tested.
 *
 * A draft lives in `lab_reviews.draft` as jsonb and is autosaved as the provider
 * types, so that a lost connection or a walk away from the desk does not cost
 * clinical work. That means **`parseDraft` is reading data written by an older
 * build of this file** the moment the shape changes, so it validates every field
 * rather than trusting the column. A draft that fails to parse degrades to an
 * empty one; it never throws, because a malformed draft must not make the review
 * screen unopenable.
 *
 * The two disposition sets mirror the two workflows. Which set applies is decided
 * by the patient's status, not by the provider — an onboarding patient cannot
 * have a dose changed because there is no protocol yet, and an active patient is
 * past the point of "treatment recommended". They share Follow-up needed: more
 * labs or a consult can be required before either workflow can decide the rest.
 */

/** For a patient who is not yet on treatment. */
export const ONBOARDING_DISPOSITIONS = [
  'treatment_recommended',
  'treatment_not_recommended',
  'follow_up_needed',
] as const

/** For a patient already on a protocol. */
export const ACTIVE_DISPOSITIONS = [
  'dose_change',
  'continue_protocol',
  'follow_up_needed',
] as const

/** Every disposition once. The workflow sets share Follow-up needed, so this is
 *  not a concatenation of the two. */
export const DISPOSITIONS = [
  'treatment_recommended',
  'treatment_not_recommended',
  'dose_change',
  'continue_protocol',
  'follow_up_needed',
] as const

export type Disposition = (typeof DISPOSITIONS)[number]

export function isDisposition(value: unknown): value is Disposition {
  return typeof value === 'string' && (DISPOSITIONS as readonly string[]).includes(value)
}

export const DISPOSITION_LABELS: Record<Disposition, string> = {
  treatment_recommended: 'Treatment recommended',
  treatment_not_recommended: 'Treatment not recommended',
  dose_change: 'Dose change',
  continue_protocol: 'Continue protocol as designed',
  follow_up_needed: 'Follow-up needed',
}

export const DISPOSITION_HINTS: Record<Disposition, string> = {
  treatment_recommended: 'Build a protocol and send pricing',
  treatment_not_recommended: 'Close out and message the patient',
  dose_change: 'Adjust an existing medication',
  continue_protocol: 'No changes; continue as prescribed',
  follow_up_needed: 'More labs, a new medication, or a message for the patient',
}

export type PatientWorkflow = 'onboarding' | 'member'

export function workflowFor(patientStatus: string | null): PatientWorkflow {
  return dispositionsFor(patientStatus) === ONBOARDING_DISPOSITIONS ? 'onboarding' : 'member'
}

/** The hint under a disposition radio. Follow-up needed cannot add a medication
 *  while the Patient is Onboarding, so that line is not the Member one. */
export function dispositionHint(
  disposition: Disposition,
  patientStatus: string | null
): string {
  if (disposition === 'follow_up_needed' && workflowFor(patientStatus) === 'onboarding') {
    return 'More labs, a consultation, or a message for the patient'
  }
  return DISPOSITION_HINTS[disposition]
}

/**
 * A change to one of the patient's existing prescriptions.
 *
 * More than one can be recorded in a review: deciding to lower testosterone and
 * to halve anastrozole is one decision made at one moment, and a form that only
 * held the first would push the second into prose where nothing downstream can
 * act on it.
 *
 * `from` is the dose being replaced, which is the only part that makes a change
 * reviewable afterwards, and `value`/`sig` split the same way `DraftMedication`
 * does: the level the chart leads with, and the instruction it works out to.
 */
export type DoseChange = {
  /** The `patient_medications` row being changed. Null only for a draft saved
   *  before the picker existed, which carries a typed name and no row. */
  medicationId: number | null
  medication: string
  /** Empty when there was nothing on record to replace. */
  from: string
  value: string
  /** Empty for a dose typed as free text, which is its own sig already. */
  sig: string
}

/**
 * A medication being added to the protocol.
 *
 * `dose` is the level as a provider would say it — `160mg/week`, or the catalog
 * instruction — and `sig` is what that level works out to, empty when the dose is
 * already written as an instruction. The same split as `DoseChange`, for the same
 * reason: the level is what the chart leads with and the sig is what the pharmacy
 * fills.
 */
export type DraftMedication = {
  /** `medications_list.id`. Null only for a draft saved before the picker
   *  existed, which carries a typed name and no catalog row. */
  medicationId: number | null
  name: string
  dose: string
  sig: string
  /**
   * Weekly milligrams, when this is a medication dosed that way.
   *
   * Stored beside `dose` rather than derived from it because approving the review
   * quotes the patient a price, and the injectables carry a surcharge above 200mg
   * a week. A number that a patient is billed against must be the one the provider
   * chose, not one recovered from the string it was displayed as.
   *
   * Null for everything not dosed in weekly milligrams — every tablet and cream,
   * which carry no surcharge — and for a draft saved before this field existed.
   */
  dosageMg: number | null
}

/**
 * Three things get written in a review, one per reader.
 *
 * `providerNote` is the chart, `patientMessage` is what the patient is sent, and
 * `csInstructions` is what a non-clinical teammate has to do. An "areas of
 * concern" box used to sit alongside them and was cut: a concern worth recording
 * is part of the assessment, and having somewhere else to put it only split the
 * clinical reasoning across two boxes that were then both read as incomplete.
 *
 * A "what the follow-up needs" checkbox group was cut for the same reason. It
 * asked the provider to declare that more labs were needed, or a medication
 * added, or the patient written to — next to the panels where they do each of
 * those things. The declaration and the act could disagree, and the checkbox is
 * the half nothing downstream can act on.
 */
export type ReviewDraft = {
  disposition: Disposition | null
  /** In the order the provider confirmed them, at most one per prescription. */
  doseChanges: DoseChange[]
  /** What the patient is told, in their words rather than the chart's. */
  patientMessage: string
  newMedications: DraftMedication[]
  /** Composed here, placed at completion. An order is a real thing that reaches
   *  the patient by email, so it waits for the same approval as the chart note
   *  rather than going out while the review is still being written. */
  labOrders: LabOrder[]
  /** Which appointment the patient is being asked to book. Staged for the same
   *  reason as a lab order: approving is what emails them the booking link. */
  consultation: ConsultRequest | null
  csInstructions: string
  /** The provider's own words for the chart, stored verbatim. */
  providerNote: string
  /**
   * A short AI summary of everything else this review did — disposition, meds,
   * emails, protocol — written when Finalize opens. The chart note is
   * `providerNote` plus this, and nothing else.
   */
  chartSummary: string
  /**
   * Steps the provider has said are not needed — see `reviewSteps.ts`.
   *
   * Stored rather than held in the component because the flyout is resumable by
   * design: a provider who decides no labs are needed, closes the flyout and comes
   * back should not be asked again. It records a decision, not a UI position,
   * which is why it belongs in the draft alongside the decisions it sits between.
   */
  skippedSteps: ReviewStepId[]
}

export const EMPTY_DRAFT: ReviewDraft = {
  disposition: null,
  doseChanges: [],
  patientMessage: '',
  newMedications: [],
  labOrders: [],
  consultation: null,
  csInstructions: '',
  providerNote: '',
  chartSummary: '',
  skippedSteps: [],
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** A row id, or null. A jsonb number can be anything, and a NaN or an Infinity
 *  here would go on to be sent as a filter value. */
function rowId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

/** A dose in milligrams, or null. Fractional — 12.5mg is a real dose — but never
 *  NaN, Infinity or negative, because this one is multiplied into a price. */
function milligrams(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    : []
}

/**
 * Dose changes, from either shape the column has held.
 *
 * A draft saved when only one change could be recorded carries five loose keys
 * and no array; it reads back as a list of one, which is exactly what it was.
 * Dropping it instead would lose a dose a provider had already worked out.
 */
function doseChangesFrom(raw: Record<string, unknown>): DoseChange[] {
  if (Array.isArray(raw.doseChanges)) {
    return rows(raw.doseChanges).map((change) => ({
      medicationId: rowId(change.medicationId),
      medication: str(change.medication),
      from: str(change.from),
      value: str(change.value),
      sig: str(change.sig),
    }))
  }

  const medication = str(raw.doseMedication)
  const value = str(raw.doseValue)
  if (!medication.trim() && !value.trim()) return []

  return [
    {
      medicationId: rowId(raw.doseMedicationId),
      medication,
      from: str(raw.doseFrom),
      value,
      sig: str(raw.doseSig),
    },
  ]
}

/**
 * The chart note, plus anything a retired "areas of concern" box was holding.
 *
 * Concerns were clinical reasoning in the provider's own words, written to be
 * read by whoever picks up the chart — which is what the note is. So an open
 * draft carrying both keeps both, joined as separate paragraphs, rather than
 * losing the half whose box no longer exists.
 */
function providerNoteFrom(raw: Record<string, unknown>): string {
  return [str(raw.providerNote).trim(), str(raw.concerns).trim()].filter(Boolean).join('\n\n')
}

/** Tolerant read of the `draft` column. Unknown keys are dropped and bad types
 *  fall back, so a shape change in this file cannot corrupt an open review. */
export function parseDraft(json: unknown): ReviewDraft {
  if (!json || typeof json !== 'object') return EMPTY_DRAFT

  const raw = json as Record<string, unknown>

  // A draft written before the catalog picker existed has a typed name and a
  // typed dose, which reads back as a medication with no provenance and no sig —
  // exactly what it was.
  // A draft written before the dose figure was captured reads back with a null,
  // which is the honest answer: the provider's number is not recoverable, and a
  // null makes the medication unpriceable rather than mispriced.
  const newMedications = rows(raw.newMedications).map((m) => ({
    medicationId: rowId(m.medicationId),
    name: str(m.name),
    dose: str(m.dose),
    sig: str(m.sig),
    dosageMg: milligrams(m.dosageMg),
  }))

  return {
    disposition: isDisposition(raw.disposition) ? raw.disposition : null,
    doseChanges: doseChangesFrom(raw),
    // `instructions` is what this field was called while it held dosing and
    // timing directions for the patient. It became the message they are sent,
    // which is the same text with a wider job, so an open draft keeps it.
    patientMessage: str(raw.patientMessage) || str(raw.instructions),
    newMedications,
    labOrders: parseOrders(raw.labOrders),
    consultation: parseConsultRequest(raw.consultation),
    csInstructions: str(raw.csInstructions),
    providerNote: providerNoteFrom(raw),
    chartSummary: str(raw.chartSummary),
    // A draft saved before the flyout was stepped has none, which degrades the
    // right way: whatever it already holds reads as settled, and anything empty is
    // asked about once, rather than a half-written review finishing on silence.
    skippedSteps: parseSkippedSteps(raw.skippedSteps),
  }
}

/**
 * True when there is nothing worth saving. Keeps an autosave from writing a row
 * just because the flyout was opened and closed.
 *
 * `skippedSteps` is deliberately not tested. No step is offered until a
 * disposition is chosen, so a draft carrying a skip carries a disposition too and
 * is already not empty; testing it as well would only add a way for the two rules
 * to drift apart.
 */
export function isDraftEmpty(draft: ReviewDraft): boolean {
  return (
    draft.disposition === null &&
    draft.newMedications.every((m) => !m.name.trim() && !m.dose.trim() && !m.sig.trim()) &&
    draft.doseChanges.every((c) => !c.medication.trim() && !c.value.trim()) &&
    draft.labOrders.length === 0 &&
    draft.consultation === null &&
    !draft.patientMessage.trim() &&
    !draft.csInstructions.trim() &&
    !draft.providerNote.trim()
  )
}

/**
 * Which disposition set a patient is eligible for.
 *
 * `user_statuses` is a 20-plus row lookup table, not a binary, so this keys on
 * the one thing that actually separates the two workflows: whether the patient
 * has an active subscription. Every "Non-Patient - …" status is onboarding, and
 * paused or cancelled patients are treated as active because they already have a
 * protocol to reason about.
 */
export function dispositionsFor(patientStatus: string | null): readonly Disposition[] {
  if (!patientStatus) return ONBOARDING_DISPOSITIONS
  return /non-patient/i.test(patientStatus) ? ONBOARDING_DISPOSITIONS : ACTIVE_DISPOSITIONS
}
