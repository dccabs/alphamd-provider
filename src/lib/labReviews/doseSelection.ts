/**
 * Choosing a dose, as data.
 *
 * Two dialogs pick a dose: changing one a patient is already on, and starting a
 * new one. They ask the same questions in the same order — weekly milligrams,
 * route and schedule for injectable testosterone; a catalog dose or a typed one
 * for everything else — and they have to produce the same pair of strings out the
 * far end, because both pairs end up on the same chart note.
 *
 * So the state is a type here and the arithmetic is a function here, and the two
 * dialogs share `DoseFields` to collect it. What comes out is a `value`, which is
 * the dose as a provider would say it, and a `sig`, which is the instruction it
 * works out to — empty for a dose that is already written as an instruction.
 */

// Explicit `.ts` specifiers: this module is exercised by `npm test`, which runs
// TypeScript through Node's type stripping and needs the real extension.
import {
  DEFAULT_CONCENTRATION,
  INJECTION_FREQUENCIES,
  injectionSig,
  startingDose,
  weeklyMgLabel,
  type Concentration,
  type Route,
} from './dosing.ts'

/** The sentinel for "none of the catalog doses". A string, so it cannot collide
 *  with a `medication_dosage.id`. */
export const PERSONAL = 'personal'

/** What a dose picker holds while it is being filled in.
 *
 *  Both halves are always present. A provider who opens the calculator, types a
 *  figure, then switches to a medication with a catalog does not lose the figure,
 *  and neither half has to be re-initialised when the other is in use. */
export type DoseSelection = {
  /** Weekly milligrams, as typed. A string because an empty number input is not
   *  a number, and `NaN` is not a state worth modelling. */
  weeklyMg: string
  concentration: Concentration
  perWeek: number
  route: Route
  /** A `medication_dosage.id` as a string, `PERSONAL`, or empty for nothing
   *  picked yet. */
  choice: string
  /** The dose typed out, when no catalog dose fits. */
  personal: string
}

/**
 * What a filled-in selection amounts to: the two strings that get recorded, and
 * the figure behind them.
 *
 * `weeklyMg` is carried because pricing needs a number and must not get it by
 * parsing one back out of `value`. A dose surcharge — $3.75 for every 10mg above
 * 200 on the injectables — is quoted to a patient off the back of it, and
 * recovering `160` from the string `160mg/week` works right up until a dose is
 * written some other way. Null for anything not dosed in weekly milligrams, which
 * is every tablet and cream in the catalog and carries no surcharge either.
 */
export type DoseValue = { value: string; sig: string; weeklyMg: number | null }

/** The doses a medication is kept at, as the picker lists them. */
export type DoseOption = { id: number; value: string }

export const DEFAULT_PER_WEEK = INJECTION_FREQUENCIES[1].perWeek

/** The starting dose the admin app's medication modal offers, which is the one a
 *  provider is most often confirming. */
export const DEFAULT_WEEKLY_MG = 160

/**
 * A selection to open a dialog on.
 *
 * `from` is the dose already on record, so the calculator starts on the figure
 * being changed rather than on a default. `previous` is a selection this provider
 * already confirmed and is reopening to edit, and it wins — the schedule and the
 * route in it cannot be recovered from `160mg/week`, which is why they are read
 * back out of the sig it generated.
 */
export function initialSelection(args: {
  from?: { weeklyMg: number; perWeek: number; route: Route; concentration?: number } | null
  /** Only the two strings, since the figure is re-read from `value` here — this
   *  is a starting point for an input, not a price. */
  previous?: {
    value: string
    sig: string
    perWeek?: number
    route?: Route
    concentration?: number
  } | null
  /** Recorded gender and state, used only when nothing is on the prescription
   *  yet. A dose change keeps `from.concentration`. */
  patient?: { gender?: string | null; state?: string | null }
  options: DoseOption[]
}): DoseSelection {
  const { from, previous, options } = args
  const start = startingDose(args.patient ?? {})

  const previousMg = previous ? Number.parseFloat(previous.value) : NaN
  const matched = previous ? options.find((o) => o.value === previous.value) : undefined
  const concentration = asConcentration(
    previous?.concentration ?? from?.concentration ?? start.concentration
  )

  return {
    weeklyMg: Number.isFinite(previousMg)
      ? String(previousMg)
      : from
        ? String(from.weeklyMg)
        : String(start.weeklyMg),
    concentration,
    perWeek: previous?.perWeek ?? from?.perWeek ?? DEFAULT_PER_WEEK,
    route: previous?.route ?? from?.route ?? 'subcutaneously',
    choice: matched ? String(matched.id) : previous?.value ? PERSONAL : '',
    personal: previous && !matched ? previous.value : '',
  }
}

function asConcentration(value: number): Concentration {
  return value === 20 || value === 50 ? value : DEFAULT_CONCENTRATION
}

/**
 * The dose a selection describes, or null while it is unusable.
 *
 * `calculated` is the caller's answer to whether this medication is dosed in
 * weekly milligrams — see `dosesInWeeklyMg`. It decides which half of the
 * selection is read and is never inferred from what happens to be filled in,
 * because a leftover figure in the calculator must not turn a tablet into an
 * injection.
 *
 * A medication with no catalog doses leaves typing as the only way, so the typed
 * dose is read whether or not `PERSONAL` was explicitly picked.
 */
export function selectionValue(
  selection: DoseSelection,
  args: { calculated: boolean; options: DoseOption[] }
): DoseValue | null {
  if (args.calculated) {
    const mg = Number.parseFloat(selection.weeklyMg)
    if (!Number.isFinite(mg) || mg <= 0) return null

    return {
      value: weeklyMgLabel(mg),
      sig: injectionSig({
        weeklyMg: mg,
        perWeek: selection.perWeek,
        route: selection.route,
        concentration: selection.concentration,
      }),
      weeklyMg: mg,
    }
  }

  if (selection.choice === PERSONAL || args.options.length === 0) {
    const typed = selection.personal.trim()
    // The dose is the instruction already, so there is no second sentence to
    // generate from it.
    return typed ? { value: typed, sig: '', weeklyMg: null } : null
  }

  const picked = args.options.find((option) => String(option.id) === selection.choice)
  return picked ? { value: picked.value, sig: '', weeklyMg: null } : null
}
