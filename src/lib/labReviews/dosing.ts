/**
 * Reading and writing testosterone dosing, in weekly milligrams.
 *
 * A prescription is stored as a sentence — `medication_dosage_personal.value`
 * holds `Inject .35mL subcutaneously twice weekly on same days every week.` —
 * but a dose change is decided in mg per week. Nothing in the database holds the
 * mg, so it has to be derived from the sentence and written back into a new one.
 * Both directions are here, and both are pure, so the flyout and its tests can
 * share them without a database.
 *
 * The arithmetic is the admin medications tab's, from `components/AddMedication`
 * in the alphamd repo: `mL = weeklyMg / 200 / injectionsPerWeek`. Keeping the
 * same formula and the same frequency phrases means a dose written here reads
 * like the ones already on the chart, and parses back to the mg it was built
 * from.
 *
 * **The concentration is the whole safety story.** 200mg/mL is true of
 * testosterone cypionate and false of most other injectables the clinic
 * prescribes: `HCG` is dosed in units, `Semaglutide`, `Sermorelin`, `Tirzepatide`
 * and `Nandrolone` all store mL-based sigs at their own concentrations. Reading a
 * mL figure and multiplying by 200 would put a confident, wrong number in front
 * of a prescriber. So `readDose` refuses to compute mg unless the medication is
 * named testosterone, and refuses again if the sig states a concentration that
 * is not 200mg/mL. Everything it will not read comes back `opaque`, which the UI
 * turns into a plain text field.
 */

// Explicit `.ts` specifier, like the other modules `npm test` runs through Node's
// type stripping. See the note on `allowImportingTsExtensions` in tsconfig.json.
import { MEDICATION } from './clinicalIds.ts'

/** The concentration every testosterone cypionate vial is compounded at. */
const MG_PER_ML = 200

/** Doses are decided, and written, in multiples of ten milligrams a week. */
const DOSE_STEP = 10

/**
 * How far below a level the arithmetic is allowed to land and still be read as
 * that level.
 *
 * The volume in a sig is a rounded rendering of a dose that was chosen in
 * milligrams, so multiplying it back out lands near the level rather than on it:
 * `.333mL on MWF` is 199.8 and `.265mL on MWF` is 159. Two milligrams is wider
 * than the 0.7 a three-decimal volume can be off by, which covers the sigs
 * written with coarser arithmetic than that.
 */
const LEVEL_SLACK = 2

export type Route = 'subcutaneously' | 'intramuscularly'

/**
 * A prescription's current dose, either understood well enough to change by the
 * milligram or not understood at all.
 *
 * `text` is the sig as written, and it is on both cases: an opaque dose has
 * nothing else to show a provider, and a dose that was understood still has to
 * be displayed in the words the pharmacy used rather than only as a figure this
 * module derived.
 */
export type CurrentDose =
  | {
      kind: 'injection'
      text: string
      mlPerDose: number
      perWeek: number
      weeklyMg: number
      route: Route
    }
  | { kind: 'opaque'; text: string | null }

/** Both routes, in the words a sig is written in. Named here so the picker, the
 *  parser and the generated instruction cannot drift apart. */
export const INJECTION_ROUTES: { route: Route; label: string }[] = [
  { route: 'subcutaneously', label: 'Subcutaneous' },
  { route: 'intramuscularly', label: 'Intramuscular' },
]

/** The schedules the admin builder offers, as injections per week. `every other
 *  day` is 3.5 rather than 3 because that is what it works out to, and the mL
 *  per dose has to divide by the real number. */
export const INJECTION_FREQUENCIES: { perWeek: number; label: string }[] = [
  { perWeek: 1, label: 'Once weekly' },
  { perWeek: 2, label: 'Twice weekly (every 3.5 days)' },
  { perWeek: 3, label: 'Three times weekly (MWF)' },
  { perWeek: 3.5, label: 'Every other day' },
  { perWeek: 7, label: 'Daily' },
]

/** How each schedule is written into a sig. Matches the admin builder word for
 *  word, so a generated sig is indistinguishable from an existing one. */
const FREQUENCY_PHRASE = new Map<number, string>([
  [1, 'once weekly on the same day every week'],
  [2, 'every 3.5 days'],
  [3, 'on MWF'],
  [3.5, 'every other day'],
  [7, 'daily'],
])

/** Only the medications this module's concentration is true of. */
const TESTOSTERONE = /testosterone/i

/**
 * Whether a medication is dosed in weekly milligrams, by catalog id.
 *
 * `readDose` has a sig to read and can gate on the words in it. Starting a
 * medication has no sig yet, only a `medications_list` row, so the calculator has
 * to be decided from the identity of the medication alone — and the name will not
 * do it: `Testosterone cream` and `Testosterone gel` both match
 * `/testosterone/i`, and neither is 200mg/mL. Both keep their catalog doses,
 * which are written in clicks.
 */
export function dosesInWeeklyMg(medicationId: number): boolean {
  return (
    medicationId === MEDICATION.testosteroneCypionate ||
    medicationId === MEDICATION.testosteroneEnanthate
  )
}

/** `.35mL`, `0.4 mL`, `0.267mL`. Digits are required immediately before the
 *  unit, which is what keeps the `mg/mL` in a stated concentration from being
 *  read as a volume. */
const ML = /(\d*\.?\d+)\s*mL/i

/** A stated concentration, so an unusual one can be refused rather than assumed
 *  to be 200. */
const CONCENTRATION = /(\d*\.?\d+)\s*mg\s*\/\s*mL/i

/**
 * The current dose of a prescription, in weekly milligrams where that can be
 * established.
 *
 * Frequency is read by phrase, in the same order the admin tab reads it, because
 * the phrases overlap: `every other day` and `every 3.5 days` both contain a
 * day count, and `daily` is a substring of neither but appears inside other
 * schedules. A sig whose schedule cannot be recognised is opaque rather than
 * assumed weekly — a wrong denominator changes the dose by a factor of the
 * frequency.
 */
export function readDose(med: { name: string; dosage: string | null }): CurrentDose {
  const text = med.dosage?.trim() || null
  const opaque: CurrentDose = { kind: 'opaque', text }

  if (!text || !TESTOSTERONE.test(med.name)) return opaque

  const stated = text.match(CONCENTRATION)
  if (stated && Number(stated[1]) !== MG_PER_ML) return opaque

  const ml = text.match(ML)
  if (!ml) return opaque

  const mlPerDose = Number(ml[1])
  if (!Number.isFinite(mlPerDose) || mlPerDose <= 0) return opaque

  const perWeek = readFrequency(text)
  if (perWeek === null) return opaque

  return {
    kind: 'injection',
    text,
    mlPerDose,
    perWeek,
    weeklyMg: doseLevel(mlPerDose * MG_PER_ML * perWeek),
    route: readRoute(text),
  }
}

/**
 * The dose level a computed weekly figure belongs to, rounded down.
 *
 * `.129mL daily` multiplies out to 180.6mg, and showing a provider `181mg/week`
 * invites them to read a precision into the prescription that was never there —
 * the patient is on 180. So a figure is taken down to the ten below it, once the
 * slack a written volume introduces has been allowed for, which lifts 199.8 to
 * 200 rather than dropping it to 190.
 *
 * Anything under a single step is left as it is: there is no level beneath ten
 * milligrams to round to, and a mistyped volume is better shown as the small
 * number it is than as nothing.
 */
function doseLevel(weeklyMg: number): number {
  const level = Math.floor((weeklyMg + LEVEL_SLACK) / DOSE_STEP) * DOSE_STEP
  return level < DOSE_STEP ? Math.round(weeklyMg) : level
}

function readFrequency(sig: string): number | null {
  const text = sig.toLowerCase()

  if (text.includes('daily')) return 7
  if (text.includes('every other day')) return 3.5
  if (text.includes('every 3.5 days')) return 2
  if (text.includes('three times weekly') || text.includes('mwf')) return 3
  if (text.includes('twice weekly')) return 2
  if (text.includes('once weekly') || text.includes('once a week')) return 1

  return null
}

/** Subcutaneous unless the sig says otherwise: it is the admin form's default and
 *  the route on almost every row in production, and a dose change is not the
 *  moment to silently move a patient to intramuscular. */
function readRoute(sig: string): Route {
  return /intramuscular|\bIM\b/i.test(sig) ? 'intramuscularly' : 'subcutaneously'
}

/** The volume one injection has to be to deliver a weekly dose on a schedule. */
export function mlPerDose(weeklyMg: number, perWeek: number): number {
  if (!Number.isFinite(weeklyMg) || !Number.isFinite(perWeek) || perWeek <= 0) return 0
  return weeklyMg / MG_PER_ML / perWeek
}

/**
 * A sig for a changed dose.
 *
 * It stops at the instruction. The admin builder appends
 * `12.5 weeks, (11 weeks). 25 supplies.`, which is a function of the vial size
 * being dispensed — and nothing is being dispensed here. A review documents the
 * decision; the pharmacy detail is added when the prescription itself is edited.
 */
export function injectionSig(dose: { weeklyMg: number; perWeek: number; route: Route }): string {
  const phrase = FREQUENCY_PHRASE.get(dose.perWeek) ?? `${dose.perWeek} times weekly`
  return `Inject ${formatMl(mlPerDose(dose.weeklyMg, dose.perWeek))}mL ${dose.route} ${phrase}.`
}

/** `.4`, `.267`, `.5` — three decimals with the leading and trailing zeros taken
 *  off, which is how every existing sig in production is written. Stripping both
 *  ends would leave nothing at all of a zero, so that case is spelled out. */
function formatMl(ml: number): string {
  if (!Number.isFinite(ml) || ml <= 0) return '0'

  return ml
    .toFixed(3)
    .replace(/^0+/, '')
    .replace(/\.?0+$/, '')
}

/** The one way a dose level is written, so the medication list, the confirm
 *  dialog, the chart note and the queue all say it the same way. */
export function weeklyMgLabel(weeklyMg: number): string {
  return `${Math.round(weeklyMg)}mg/week`
}
