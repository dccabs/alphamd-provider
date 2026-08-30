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
 * in the alphamd repo: `mL = weeklyMg / concentration / injectionsPerWeek`.
 * Keeping the same formula and the same frequency phrases means a dose written
 * here reads like the ones already on the chart, and parses back to the mg it
 * was built from.
 *
 * **The Concentration is the whole safety story.** 20, 50 and 200 mg/mL are the
 * vials the clinic dispenses for injectable testosterone. Most other injectables
 * store mL-based sigs at their own concentrations: `HCG` is dosed in units,
 * `Semaglutide`, `Sermorelin`, `Tirzepatide` and `Nandrolone` all differ.
 * Reading a mL figure and multiplying by 200 would put a confident, wrong number
 * in front of a prescriber. So `readDose` refuses to compute mg unless the
 * medication is named testosterone, and refuses again if the sig states a
 * Concentration that is not 20, 50 or 200. An unstated Concentration is read as
 * 200 — that is what every existing house sig assumed. Everything it will not
 * read comes back `opaque`, which the UI turns into a plain text field.
 */

// Explicit `.ts` specifier, like the other modules `npm test` runs through Node's
// type stripping. See the note on `allowImportingTsExtensions` in tsconfig.json.
import { MEDICATION } from './clinicalIds.ts'

/** The house default, and what an unstated Concentration on an existing sig is. */
export const DEFAULT_CONCENTRATION = 200

/** The vials the clinic dispenses for injectable testosterone. */
export const CONCENTRATIONS = [20, 50, 200] as const

export type Concentration = (typeof CONCENTRATIONS)[number]

const KNOWN_CONCENTRATION = new Set<number>(CONCENTRATIONS)

/** Doses at 200mg/mL are decided in tens; 20 and 50 are decided in fives. */
const DOSE_STEP_200 = 10
const DOSE_STEP_DILUTE = 5

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
      concentration: Concentration
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
 * `/testosterone/i`, and neither is an injectable vial. Both keep their catalog
 * doses, which are written in clicks.
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
  const concentration = stated ? Number(stated[1]) : DEFAULT_CONCENTRATION
  if (!KNOWN_CONCENTRATION.has(concentration)) return opaque

  const ml = text.match(ML)
  if (!ml) return opaque

  const volume = Number(ml[1])
  if (!Number.isFinite(volume) || volume <= 0) return opaque

  const perWeek = readFrequency(text)
  if (perWeek === null) return opaque

  return {
    kind: 'injection',
    text,
    mlPerDose: volume,
    perWeek,
    weeklyMg: doseLevel(volume * concentration * perWeek, concentration),
    concentration: concentration as Concentration,
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
function doseStep(concentration: number): number {
  return concentration === DEFAULT_CONCENTRATION ? DOSE_STEP_200 : DOSE_STEP_DILUTE
}

function doseLevel(weeklyMg: number, concentration: number = DEFAULT_CONCENTRATION): number {
  const step = doseStep(concentration)
  const level = Math.floor((weeklyMg + LEVEL_SLACK) / step) * step
  return level < step ? Math.round(weeklyMg) : level
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
export function mlPerDose(
  weeklyMg: number,
  perWeek: number,
  concentration: number = DEFAULT_CONCENTRATION
): number {
  if (!Number.isFinite(weeklyMg) || !Number.isFinite(perWeek) || perWeek <= 0) return 0
  if (!Number.isFinite(concentration) || concentration <= 0) return 0
  return weeklyMg / concentration / perWeek
}

/**
 * A sig for a changed dose.
 *
 * It stops at the instruction plus the Concentration. The admin builder appends
 * `12.5 weeks, (11 weeks). 25 supplies.`, which is a function of the vial size
 * being dispensed — and nothing is being dispensed here. A review documents the
 * decision; the pharmacy detail is added when the prescription itself is edited.
 *
 * Concentration is always named, including 200, so the next review does not have
 * to guess. See `docs/adr/0003-testosterone-concentration-on-sig.md`.
 */
export function injectionSig(dose: {
  weeklyMg: number
  perWeek: number
  route: Route
  concentration?: number
}): string {
  const concentration = dose.concentration ?? DEFAULT_CONCENTRATION
  const phrase = FREQUENCY_PHRASE.get(dose.perWeek) ?? `${dose.perWeek} times weekly`
  return `Inject ${formatMl(mlPerDose(dose.weeklyMg, dose.perWeek, concentration))}mL ${dose.route} ${phrase}. ${concentration}mg/mL.`
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

/**
 * Who the picker is showing options for, from the chart — the same three groups
 * the admin pricing modal uses. Blank and `other` are male: that is the house
 * default, and consultations already treat an unset gender that way.
 */
export type DoseAudience = 'male' | 'female' | 'california_female'

export const AUDIENCE_NOTICE: Record<DoseAudience, string> = {
  male: 'Showing options for males',
  female: 'Showing options for female patients — non California',
  california_female: 'Showing options for female California patients',
}

export type StartingDose = {
  concentration: Concentration
  weeklyMg: number
  weeklyMgStep: number
  audience: DoseAudience
}

const MALE_START: StartingDose = {
  concentration: 200,
  weeklyMg: 160,
  weeklyMgStep: 10,
  audience: 'male',
}

const FEMALE_START: StartingDose = {
  concentration: 20,
  weeklyMg: 10,
  weeklyMgStep: 5,
  audience: 'female',
}

const CALIFORNIA_FEMALE_START: StartingDose = {
  concentration: 50,
  weeklyMg: 10,
  weeklyMgStep: 5,
  audience: 'california_female',
}

function isFemale(gender: string | null | undefined): boolean {
  const value = (gender ?? '').trim().toLowerCase()
  return value === 'female' || value === 'f'
}

function isCalifornia(state: string | null | undefined): boolean {
  return (state ?? '').trim().toLowerCase() === 'california'
}

export function doseAudience(patient: {
  gender?: string | null
  state?: string | null
}): DoseAudience {
  if (!isFemale(patient.gender)) return 'male'
  return isCalifornia(patient.state) ? 'california_female' : 'female'
}

/** Defaults when *starting* a medication. A dose change keeps what is already on
 *  the prescription — see `offeredConcentrations`. */
export function startingDose(patient: {
  gender?: string | null
  state?: string | null
}): StartingDose {
  switch (doseAudience(patient)) {
    case 'california_female':
      return CALIFORNIA_FEMALE_START
    case 'female':
      return FEMALE_START
    case 'male':
      return MALE_START
  }
}

/**
 * Concentrations the picker offers.
 *
 * California females are locked to 50, matching the pricing modal. An existing
 * prescription that is already at 20 or 200 stays on the list so opening a dose
 * change does not silently reformulate it.
 */
export function offeredConcentrations(args: {
  gender?: string | null
  state?: string | null
  current?: number | null
}): Concentration[] {
  const offered: Concentration[] =
    doseAudience(args) === 'california_female' ? [50] : [...CONCENTRATIONS]

  const current = args.current
  if (current != null && KNOWN_CONCENTRATION.has(current) && !offered.includes(current as Concentration)) {
    offered.push(current as Concentration)
    offered.sort((a, b) => a - b)
  }

  return offered
}

export function weeklyMgStep(concentration: number): number {
  return doseStep(concentration)
}
