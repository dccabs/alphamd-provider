/**
 * The three written fields of a lab review that the assistant can draft.
 *
 * Keyed to `ReviewDraft`'s own property names rather than to labels of their own,
 * so the button in the flyout, the wire format and the prompt cannot drift apart
 * — the field a draft is requested for is literally the key it is written back
 * into.
 *
 * Only the vocabulary and the on-screen copy live here, which keeps this
 * importable by the client component. The prompt wording for each field is in
 * `prompts.ts` with the rest of the prompts, so all of it can be read in one
 * place.
 */

export const REVIEW_FIELDS = ['providerNote', 'patientMessage', 'csInstructions'] as const

export type ReviewField = (typeof REVIEW_FIELDS)[number]

export function isReviewField(value: unknown): value is ReviewField {
  return typeof value === 'string' && (REVIEW_FIELDS as readonly string[]).includes(value)
}

/** As the field is titled in the flyout, so the modal names the same thing the
 *  provider clicked next to. */
export const FIELD_LABELS: Record<ReviewField, string> = {
  providerNote: 'Note for the chart',
  patientMessage: 'Message for patient',
  csInstructions: 'Instructions for customer service',
}

/**
 * What to type in the steer box.
 *
 * Written as shorthand on purpose. The assistant's job is to write out what the
 * provider tells it, so the examples show the shortest input that is enough —
 * anything longer suggests they should have typed the field themselves.
 */
export const FIELD_STEER_PLACEHOLDERS: Record<ReviewField, string> = {
  providerNote: 'e.g. lowered T for rising hct, everything else stable, recheck in 8wks',
  patientMessage: 'e.g. reassure him, the new dose is nothing to worry about',
  csInstructions: 'e.g. update the shipment to the new dose and book the 8 week draw',
}

/**
 * Whether the decisions already recorded in the review are this field's subject
 * or its background.
 *
 * The patient message exists to *relay* the decision — the dose that changed and
 * when the next draw is are the message, and a draft that left them out would be
 * empty. The chart note and the customer service box are written alongside those
 * same decisions, which the composed note already states in full, so repeating
 * them there is duplication the provider then has to delete.
 *
 * A real split rather than a hypothetical one: `relay` and `background` each have
 * a field behind them, and the two want opposite things from the same context.
 */
export const RECORDED_USE: Record<ReviewField, 'relay' | 'background'> = {
  providerNote: 'background',
  patientMessage: 'relay',
  csInstructions: 'background',
}

/** One line under the modal title. Says what this will and will not do, because
 *  the whole value of the tool depends on the provider trusting that. */
export const FIELD_CONTRACT_NOTE =
  'It writes out what you tell it, in the voice this field needs. It will not add findings, recommendations or opinions of its own.'
