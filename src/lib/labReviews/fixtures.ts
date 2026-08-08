/**
 * Every static fixture on the lab-review screen, in one file.
 *
 * A region appears here only when there is nowhere in the database to persist
 * it, and Dan's constraint for this iteration is that the portal does not
 * modify the alphamd repo — which is where migrations live. Each fixture is
 * rendered behind a visible marker ("Sample data", or "Draft only — not saved"
 * for the review modal), and each is listed in README.md under "Not yet wired
 * to real data" with what unblocks it.
 *
 * An unlabelled static region is a bug. If you wire one of these up, delete it
 * from here and from the README list in the same change.
 */

/** Review modal — protocol decision options.
 *  Blocked on: a `lab_review_outcomes` table. `lab_reviews` has `resolution`
 *  (free text) and nothing structured, and no draft state at all. */
export const PROTOCOL_DECISIONS = [
  {
    id: 'keep',
    label: 'Keep current protocol',
    hint: 'No changes; continue as prescribed',
  },
  {
    id: 'dose',
    label: 'Dose change',
    hint: 'Adjust an existing medication',
  },
  {
    id: 'instructions',
    label: 'New instructions',
    hint: 'Protocol stays; guidance changes',
  },
] as const

export type ProtocolDecisionId = (typeof PROTOCOL_DECISIONS)[number]['id']

/** "More actions" menu. Everything except "Generate new protocol" maps to
 *  columns that already exist and lands in phase 2; "Generate new protocol"
 *  has no traced implementation, so it stays inert and labelled. */
export const MORE_ACTIONS = [
  { id: 'generate-protocol', label: 'Generate new protocol', static: true },
  { id: 'notify-director', label: 'Notify director (review note)', static: false },
  { id: 'message-cs', label: 'Message customer service', static: false },
  { id: 'needs-attention', label: 'Mark needs attention', static: false },
] as const

export const STATIC_NOTICES = {
  reviewModal: 'Draft only — not saved',
  assignInstructions:
    'Assignment instructions are not stored yet, so this field is disabled rather than discarding what you type.',
  generateProtocol: 'Not wired up yet.',
} as const
