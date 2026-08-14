/**
 * Every static fixture on the lab-review screen, in one file.
 *
 * A region appears here only when there is nowhere in the database to persist it,
 * or no traced implementation to copy. Each fixture is rendered behind a visible
 * marker, and each is listed in README.md under "Not yet wired to real data" with
 * what unblocks it.
 *
 * An unlabelled static region is a bug. If you wire one of these up, delete it
 * from here and from the README list in the same change.
 */

/** "More actions" menu.
 *  Blocked on: reading the real flows in the main app. "Generate new protocol"
 *  has no traced implementation at all; "Notify director" has no identified
 *  recipient or delivery mechanism. Both stay inert and labelled rather than
 *  guessing at clinical routing. */
export const MORE_ACTIONS = [
  { id: 'generate-protocol', label: 'Generate new protocol', static: true },
  { id: 'notify-director', label: 'Notify director (review note)', static: true },
] as const

export const STATIC_NOTICES = {
  generateProtocol: 'Not wired up yet.',
} as const
