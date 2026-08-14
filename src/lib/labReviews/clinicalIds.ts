/**
 * Flag and patient-status row ids, named.
 *
 * These are bare numbers in the main app's code. They are mirrored here as
 * constants because a literal `6` in a completion path is unreviewable — nobody
 * can tell from the call site whether it is the right flag, and the cost of being
 * wrong is a flag on a patient's chart that says something untrue.
 *
 * Verified against production. Changing a label in `user_flags` or `user_statuses`
 * does not change these ids, which is exactly why the id is what gets stored.
 */

export const FLAG = {
  /** "Follow Up Required" — somebody needs to act on this patient. */
  followUpRequired: 2,
  /** "Needs lab review" — cleared when a review is completed. Carries no history;
   *  `lab_reviews` is the record. */
  needsLabReview: 3,
  /** "Labs reviewed, no changes recommended" — only true for continue-protocol. */
  labsReviewedNoChanges: 6,
} as const

export const PATIENT_STATUS = {
  /** "Non-Patient - Pricing sent to PT" */
  pricingSentToPatient: 25,
  /** "Non-Patient - Treatment NOT Recommended" */
  treatmentNotRecommended: 26,
} as const

/**
 * `medications_list` rows this app has to reason about by identity rather than by
 * name.
 *
 * Only the two injectable testosterones are here, and only because the
 * weekly-milligram calculator is true of them and false of the rest of the
 * catalog. Gating on the name instead would catch `Testosterone cream` and
 * `Testosterone gel`, which are dosed in clicks and grams at their own
 * concentrations.
 */
export const MEDICATION = {
  testosteroneCypionate: 1,
  testosteroneEnanthate: 32,
} as const

/**
 * Medications that may not be added to a protocol anywhere on the site — 25 is
 * Anavar (Oxandrolone) and 26 is Nandrolone.
 *
 * Mirrors `constants/restrictedMedications.ts` in the main app, which filters
 * them out of every picker and rejects them in `POST /api/addPatientMedication`.
 * Rows that already reference them stay visible as history, so this is a filter
 * on what can be *offered*, never on what can be displayed.
 */
export const RESTRICTED_MEDICATION_IDS = [25, 26]
