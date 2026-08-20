/**
 * Patient picker for the lab-review queue: who matches a query, in what order,
 * and how their reviews are summarised.
 *
 * The database adapter in `queries.ts` loads candidates; this module is the
 * whole decision. Tests cover matching and ranking through `searchPatients`
 * rather than the query that feeds it.
 */

export const PATIENT_SEARCH_MIN_CHARS = 2
export const PATIENT_SEARCH_LIMIT = 10

export type QueuePatient = {
  patientId: string
  name: string
  email: string | null
}

export type PatientSuggestion = QueuePatient & {
  needsAttention: number
  active: number
  finished: number
}

export type PatientSearchRow = {
  patientId: string
  firstName: string
  lastName: string
  email: string
  needsAttention: number
  active: number
  finished: number
  lastSourceAt: string | null
}

export function tokensOf(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean)
}

export function suggestionSubtitle(
  counts: Pick<PatientSuggestion, 'needsAttention' | 'active' | 'finished'>
): string {
  const parts = [
    counts.needsAttention ? `${counts.needsAttention} needs attention` : null,
    counts.active ? `${counts.active} active` : null,
    counts.finished ? `${counts.finished} finished` : null,
  ].filter(Boolean)
  return parts.join(' · ') || 'No lab reviews'
}

/**
 * Keep people whose first name, last name, full name, or email contains every
 * token. Order is needs-attention, then active, then finished, then none;
 * within a band, most recent lab activity, then last name.
 */
export function searchPatients(
  people: PatientSearchRow[],
  query: string,
  limit = PATIENT_SEARCH_LIMIT
): PatientSuggestion[] {
  if (query.trim().length < PATIENT_SEARCH_MIN_CHARS) return []

  const tokens = tokensOf(query)
  if (!tokens.length) return []

  return people
    .filter((person) => matches(person, tokens))
    .sort(comparePeople)
    .slice(0, limit)
    .map((person) => ({
      patientId: person.patientId,
      name: displayName(person),
      email: person.email.trim() || null,
      needsAttention: person.needsAttention,
      active: person.active,
      finished: person.finished,
    }))
}

function matches(person: PatientSearchRow, tokens: string[]): boolean {
  const first = person.firstName.toLowerCase()
  const last = person.lastName.toLowerCase()
  const full = `${first} ${last}`.trim()
  const email = person.email.toLowerCase()
  const fields = [first, last, full, email]

  return tokens.every((token) => fields.some((field) => field.includes(token)))
}

function comparePeople(a: PatientSearchRow, b: PatientSearchRow): number {
  const heatDiff = heatOf(a) - heatOf(b)
  if (heatDiff !== 0) return heatDiff

  const recency = recencyOf(b.lastSourceAt) - recencyOf(a.lastSourceAt)
  if (recency !== 0) return recency

  const last = a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' })
  if (last !== 0) return last

  return a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' })
}

function heatOf(person: PatientSearchRow): number {
  if (person.needsAttention > 0) return 0
  if (person.active > 0) return 1
  if (person.finished > 0) return 2
  return 3
}

function recencyOf(value: string | null): number {
  if (!value) return 0
  const time = Date.parse(value)
  return Number.isNaN(time) ? 0 : time
}

function displayName(person: PatientSearchRow): string {
  const name = [person.firstName, person.lastName].filter(Boolean).join(' ').trim()
  return name || 'Unknown patient'
}
