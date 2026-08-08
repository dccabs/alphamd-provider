/**
 * Note shape and filtering. Pure and dependency-free — deliberately *not* in
 * `tabs.ts`, which is `server-only`: the segmented filter is client-side
 * interactivity, and this way it is unit-testable too.
 */

export type NoteTag = 'PROVIDER' | 'INTERNAL' | 'STAFF' | 'PATIENT' | 'SYSTEM'

export const NOTE_FILTERS = ['provider', 'internal', 'all'] as const
export type NoteFilter = (typeof NOTE_FILTERS)[number]

export const NOTE_FILTER_LABELS: Record<NoteFilter, string> = {
  provider: 'Provider',
  internal: '+ Internal',
  all: 'All',
}

export type Note = {
  id: number
  author: string
  tag: NoteTag
  createdAt: string | null
  note: string
  isOfficialVisit: boolean
}

/**
 * The design's `Provider / + Internal / All` control.
 *
 * PROVIDER comes from `user_roles_join` role 3, never `user_list.role` (which
 * has zero provider rows in production). INTERNAL is the real
 * `is_internal_only` column. PATIENT is a genuine case — patients author the
 * "User uploaded a new file" rows — so `all` is meaningfully wider than
 * `internal`, not just a synonym.
 */
export function filterNotes(notes: Note[], filter: NoteFilter): Note[] {
  if (filter === 'all') return notes
  if (filter === 'internal') {
    return notes.filter((n) => n.tag === 'PROVIDER' || n.tag === 'INTERNAL')
  }
  return notes.filter((n) => n.tag === 'PROVIDER')
}
