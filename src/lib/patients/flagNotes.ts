/**
 * The note on a Patient Flag, as more than one writer builds it up.
 *
 * A patient has one row per flag, so one `description`. The admin app already
 * writes its own notes there ("Order issue reported: …"), and a Lab Review now
 * adds what customer service has to do. Neither may erase the other: CS removes
 * the flag once everything on it is done, so a note that vanished is work that
 * was never seen.
 *
 * Each Lab Review writes one section, headed with a short ref to the review.
 * Finalizing the same review again replaces its own section rather than adding
 * a second copy.
 */

export const FLAG_NOTE_SEPARATOR = '\n\n———\n\n'

export type FlagNoteSection = {
  /** Stable per writer, e.g. the first eight characters of the review id. */
  ref: string
  /** Who and when, e.g. `Lab review by Dr Smith, Sep 24`. */
  heading: string
  body: string
}

export function renderFlagNoteSection(section: FlagNoteSection): string {
  return `${section.heading} (ref ${section.ref})\n${section.body.trim()}`
}

export function mergeFlagNote(
  existing: string | null | undefined,
  section: FlagNoteSection
): string {
  const text = renderFlagNoteSection(section)
  const current = existing?.trim()
  if (!current) return text

  const parts = current.split(FLAG_NOTE_SEPARATOR)
  const marker = `(ref ${section.ref})`
  const at = parts.findIndex((part) => part.split('\n', 1)[0].endsWith(marker))
  if (at >= 0) parts[at] = text
  else parts.push(text)
  return parts.join(FLAG_NOTE_SEPARATOR)
}
