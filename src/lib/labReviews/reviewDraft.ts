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
 * past the point of "treatment recommended".
 */

/** For a patient who is not yet on treatment. */
export const ONBOARDING_DISPOSITIONS = [
  'treatment_recommended',
  'treatment_not_recommended',
] as const

/** For a patient already on a protocol. */
export const ACTIVE_DISPOSITIONS = [
  'dose_change',
  'continue_protocol',
  'follow_up_needed',
] as const

export const DISPOSITIONS = [...ONBOARDING_DISPOSITIONS, ...ACTIVE_DISPOSITIONS] as const

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
  follow_up_needed: 'More labs, a new medication, or specific instructions',
}

/** What a follow-up actually needs. More than one can apply. */
export const FOLLOW_UP_KINDS = ['more_labs', 'new_medication', 'patient_instructions'] as const

export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number]

export const FOLLOW_UP_LABELS: Record<FollowUpKind, string> = {
  more_labs: 'Needs more labs',
  new_medication: 'Add a new medication',
  patient_instructions: 'Specific patient instructions',
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
}

export type ReviewDraft = {
  disposition: Disposition | null
  followUpKinds: FollowUpKind[]
  /** In the order the provider confirmed them, at most one per prescription. */
  doseChanges: DoseChange[]
  instructions: string
  newMedications: DraftMedication[]
  concerns: string
  csInstructions: string
  /** The provider's own half of the chart note. The generated half is composed at
   *  completion, not stored here. */
  providerNote: string
}

export const EMPTY_DRAFT: ReviewDraft = {
  disposition: null,
  followUpKinds: [],
  doseChanges: [],
  instructions: '',
  newMedications: [],
  concerns: '',
  csInstructions: '',
  providerNote: '',
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** A row id, or null. A jsonb number can be anything, and a NaN or an Infinity
 *  here would go on to be sent as a filter value. */
function rowId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
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

/** Tolerant read of the `draft` column. Unknown keys are dropped and bad types
 *  fall back, so a shape change in this file cannot corrupt an open review. */
export function parseDraft(json: unknown): ReviewDraft {
  if (!json || typeof json !== 'object') return EMPTY_DRAFT

  const raw = json as Record<string, unknown>

  const followUpKinds = Array.isArray(raw.followUpKinds)
    ? (raw.followUpKinds.filter(
        (k): k is FollowUpKind =>
          typeof k === 'string' && (FOLLOW_UP_KINDS as readonly string[]).includes(k)
      ) as FollowUpKind[])
    : []

  // A draft written before the catalog picker existed has a typed name and a
  // typed dose, which reads back as a medication with no provenance and no sig —
  // exactly what it was.
  const newMedications = rows(raw.newMedications).map((m) => ({
    medicationId: rowId(m.medicationId),
    name: str(m.name),
    dose: str(m.dose),
    sig: str(m.sig),
  }))

  return {
    disposition: isDisposition(raw.disposition) ? raw.disposition : null,
    // Deduplicated: the checkbox group can only produce one of each, but a
    // hand-edited or older payload can carry repeats.
    followUpKinds: [...new Set(followUpKinds)],
    doseChanges: doseChangesFrom(raw),
    instructions: str(raw.instructions),
    newMedications,
    concerns: str(raw.concerns),
    csInstructions: str(raw.csInstructions),
    providerNote: str(raw.providerNote),
  }
}

/** True when there is nothing worth saving. Keeps an autosave from writing a row
 *  just because the flyout was opened and closed. */
export function isDraftEmpty(draft: ReviewDraft): boolean {
  return (
    draft.disposition === null &&
    draft.followUpKinds.length === 0 &&
    draft.newMedications.every((m) => !m.name.trim() && !m.dose.trim() && !m.sig.trim()) &&
    draft.doseChanges.every((c) => !c.medication.trim() && !c.value.trim()) &&
    !draft.instructions.trim() &&
    !draft.concerns.trim() &&
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
