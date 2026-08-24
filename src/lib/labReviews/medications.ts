// Explicit `.ts` specifier, like the other modules `npm test` runs through Node's
// type stripping. See the note on `allowImportingTsExtensions` in tsconfig.json.
import { readDose } from './dosing.ts'
import { shortDate } from './format.ts'

/**
 * Reading a prescription's expiry, and deciding what order prescriptions go in.
 *
 * Both are display concerns, but the expiry is not a trivial one.
 * `patient_medications.expiration` is a text column: blank on 2,903 of 6,413 rows,
 * an ISO date on the rest, and sometimes the empty string rather than null. And
 * the same column is what `getMedications` reads to decide `active` — so a colour
 * derived from it here has to reach the same verdict, or the list will show a
 * medication in red that the rest of the review is treating as current.
 */

/**
 * Where a prescription's expiry sits relative to today.
 *
 * `unknown` is the common case, not an error: over a third of the rows have
 * nothing usable in the column, and `getMedications` reads that emptiness as
 * *active*. So `unknown` must not be styled as a problem.
 */
export type ExpiryStatus = 'future' | 'past' | 'unknown'

/**
 * Compared as calendar dates in UTC, which is the frame `shortDate` renders in.
 *
 * That matters because the values are date-only strings: `2026-08-17` parses to
 * midnight *UTC*, so comparing it against midnight *local* — which is what
 * `getMedications` does when it sets `active` — calls a prescription expired for
 * the whole of the day it expires, anywhere west of Greenwich. Doing it in UTC
 * instead means the date shown beside the medication and the colour it is shown in
 * cannot disagree.
 *
 * The one-day divergence from `active` is deliberate and harmless here: a
 * prescription running out today reads as `future` and `active: false`, and the
 * only surface that shows both is this list, which filters on `active` before it
 * ever asks for a colour. Worth knowing about before wiring the status to
 * anything that decides what a provider may do.
 */
export function expiryStatus(expiration: string | null, now: Date = new Date()): ExpiryStatus {
  const raw = expiration?.trim()
  if (!raw) return 'unknown'

  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return 'unknown'

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())

  return date.getTime() >= today ? 'future' : 'past'
}

/**
 * The expiry as a date, or null when the column holds nothing readable.
 *
 * Null rather than an em dash: a row with no date shows no date, instead of the
 * word "Expires" followed by a shrug.
 */
export function expirationLabel(expiration: string | null): string | null {
  return expiryStatus(expiration) === 'unknown' ? null : shortDate(expiration)
}

/** Anything the clinic calls testosterone, including the cream and the gel. Unlike
 *  the dosing calculator — which gates on catalog id, because reading a mL figure
 *  off a cream at 200mg/mL would be dangerous — ordering a list by name carries no
 *  such risk, and the provider looking for "the testosterone" means any of them. */
const TESTOSTERONE = /testosterone/i

/**
 * Testosterone first, everything else in the order it arrived.
 *
 * It is the protocol nearly every review is about, and the reason the provider
 * opened the panel. Sorted from a copy because the array belongs to the page, and
 * `sort` is stable, so the newest-first order the query established survives
 * within each group.
 */
export function orderMedications<T extends { name: string }>(medications: T[]): T[] {
  return [...medications].sort(
    (a, b) => Number(TESTOSTERONE.test(b.name)) - Number(TESTOSTERONE.test(a.name))
  )
}

/** Short enough for the snapshot line. Cypionate is the one name that is both
 *  long and the medication almost every review is about. */
export function shortMedicationName(name: string): string {
  return name.replace(/\bcypionate\b/i, 'cyp').replace(/\s+/g, ' ').trim()
}

/**
 * The one-line snapshot of what the patient is on.
 *
 * Active prescriptions only: expired ones stay in the details dialog. A weekly
 * milligram figure is appended when `readDose` can establish one, so the line
 * can say `Testosterone cyp - 160mg` instead of the full injection sentence.
 */
export function medicationSummaryLine(
  medications: { name: string; dosage: string | null; active: boolean }[]
): string {
  const active = orderMedications(medications.filter((med) => med.active))
  return active
    .map((med) => {
      const name = shortMedicationName(med.name)
      const dose = readDose(med)
      return dose.kind === 'injection' ? `${name} - ${dose.weeklyMg}mg` : name
    })
    .join(', ')
}
