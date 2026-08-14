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
 * A medication being added to the protocol.
 *
 * `dose` is the level as a provider would say it — `160mg/week`, or the catalog
 * instruction — and `sig` is what that level works out to, empty when the dose is
 * already written as an instruction. The same split as `doseValue`/`doseSig`, for
 * the same reason: the level is what the chart leads with and the sig is what the
 * pharmacy fills.
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
  /** The `patient_medications` row being changed, when the provider picked one
   *  from the patient's list rather than typing a name. Kept so the dose change
   *  is traceable to a prescription, and so reopening the flyout can reselect it. */
  doseMedicationId: number | null
  doseMedication: string
  /** The dose being replaced — `140mg/week`, or the sig as written when it could
   *  not be read in milligrams. Empty when nothing was on record to replace. */
  doseFrom: string
  /** The new dose level, which is what the queue and the chart lead with. */
  doseValue: string
  /** The instruction the new level works out to, when it could be generated.
   *  Empty for a dose typed as free text, which is its own sig already. */
  doseSig: string
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
  doseMedicationId: null,
  doseMedication: '',
  doseFrom: '',
  doseValue: '',
  doseSig: '',
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
  const newMedications = Array.isArray(raw.newMedications)
    ? raw.newMedications
        .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
        .map((m) => ({
          medicationId: rowId(m.medicationId),
          name: str(m.name),
          dose: str(m.dose),
          sig: str(m.sig),
        }))
    : []

  return {
    disposition: isDisposition(raw.disposition) ? raw.disposition : null,
    // Deduplicated: the checkbox group can only produce one of each, but a
    // hand-edited or older payload can carry repeats.
    followUpKinds: [...new Set(followUpKinds)],
    // A draft written before the medication list existed carries the two text
    // fields and nothing else, which reads back as a dose change with no
    // provenance — exactly what it was.
    doseMedicationId: rowId(raw.doseMedicationId),
    doseMedication: str(raw.doseMedication),
    doseFrom: str(raw.doseFrom),
    doseValue: str(raw.doseValue),
    doseSig: str(raw.doseSig),
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
    !draft.doseMedication.trim() &&
    !draft.doseValue.trim() &&
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
