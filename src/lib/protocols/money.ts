/**
 * Money, as whole cents.
 *
 * The admin app's calculator this replaces keeps money in floating-point dollars
 * and calls a `roundCents` helper about fifteen times on the way to a total,
 * sometimes comparing a rounded running balance against an unrounded config
 * value. It arrives at the right answer on all 238 real snapshots we replay, so
 * this is not a bug hunt — it is removing the reason anyone has to check.
 *
 * Everything here is an integer number of cents. Rounding happens where a
 * percentage is taken and nowhere else, and dollars only exist at the two edges:
 * reading a `numeric` column, and writing one back.
 *
 * The arithmetic deliberately reproduces the legacy results rather than
 * improving on them, because the whole verification strategy is "replay real
 * history and match to the cent". A better rounding rule would be
 * indistinguishable from a bug. See `parity.test.ts`.
 */

/**
 * An integer number of cents.
 *
 * Branded so a raw dollar figure cannot be passed where cents are expected. That
 * mistake is silent, off by a hundred, and on this path it reaches a patient's
 * card, which is worth a little friction at the call sites.
 */
export type Cents = number & { readonly __cents: unique symbol }

/** Cents from a whole number of cents. For tests and for literals. */
export function cents(value: number): Cents {
  return Math.round(value) as Cents
}

/**
 * Cents from a `numeric` column, which arrives as a JS number through PostgREST
 * but is typed as possibly-string because that is what the driver promises.
 *
 * Null and undefined read as zero rather than throwing: `grand_total` is
 * nullable and at least one real row leaves it unset, and a missing figure in a
 * breakdown means nothing was taken off.
 */
export function fromNumeric(value: string | number | null | undefined): Cents {
  if (value === null || value === undefined || value === '') return 0 as Cents

  const dollars = typeof value === 'string' ? Number.parseFloat(value) : value
  if (!Number.isFinite(dollars)) return 0 as Cents

  return Math.round(dollars * 100) as Cents
}

/** Dollars, for writing back to a `numeric` column. */
export function toDollars(value: Cents): number {
  return value / 100
}

export function addCents(...values: Cents[]): Cents {
  return values.reduce((sum, value) => sum + value, 0) as Cents
}

export function subCents(a: Cents, b: Cents): Cents {
  return (a - b) as Cents
}

export function minCents(a: Cents, b: Cents): Cents {
  return Math.min(a, b) as Cents
}

/** Never below zero, which is where the legacy chain clamps a subtotal. */
export function clampZero(value: Cents): Cents {
  return Math.max(0, value) as Cents
}

/**
 * Cents from a scaled dollar figure, rounding exactly as the legacy chain does.
 *
 * Every scaling operation below funnels through here, and it works in dollars
 * rather than cents on purpose — which looks like the opposite of the point of
 * this module, so it is worth being clear about why.
 *
 * The obvious integer form, `Math.round(baseCents * percent / 100)`, is cleaner
 * and occasionally gives a *different answer*. 50% of $0.29 is 14.5 cents, which
 * the integer form rounds up to 15; the legacy form computes `0.29 * 0.5` as
 * `0.144999999999999998`, falls just under the half, and rounds down to 14. Same
 * for 15% of $13.70. The two rules part company whenever the exact result lands
 * on a half cent and the binary product lands just below it.
 *
 * None of the 106 percentage discounts in the replay fixture hit such a case, so
 * either rule would pass parity — but "no divergence in 30 days of history" is a
 * weaker promise than this rewrite is supposed to make, and the old admin app
 * will keep pricing protocols alongside this one for a while. Two systems that
 * quote the same protocol a cent apart is a worse outcome than one slightly
 * strange function.
 *
 * So the float path is preserved deliberately, in one place, tested against the
 * legacy expression across the whole plausible domain. `Math.round` also means
 * halves go up rather than to even, which is likewise legacy's behaviour.
 */
function legacyCents(dollars: number): Cents {
  if (!Number.isFinite(dollars)) return 0 as Cents
  return Math.round(dollars * 100) as Cents
}

/** A percentage of an amount: `pctOf(base, 20)` is 20% of it. */
export function pctOf(base: Cents, percent: number): Cents {
  if (!Number.isFinite(percent)) return 0 as Cents
  return legacyCents(toDollars(base) * (percent / 100))
}

/**
 * A rate applied to an amount. Tax rates are stored as a fraction (`0.065`), not
 * a percentage, which is the one place the two conventions sit side by side.
 */
export function rateOf(base: Cents, rate: number): Cents {
  if (!Number.isFinite(rate)) return 0 as Cents
  return legacyCents(toDollars(base) * rate)
}

/**
 * An amount taken a number of times. The billing period total is the monthly
 * figure times the months.
 */
export function timesCents(value: Cents, factor: number): Cents {
  if (!Number.isFinite(factor)) return 0 as Cents
  return legacyCents(toDollars(value) * factor)
}

/**
 * An amount split evenly, for the per-month figure legacy derives by dividing
 * the total by the number of months.
 *
 * Written as a division rather than a multiplication by the reciprocal, because
 * those are not the same in binary floating point and legacy divides.
 */
export function divideCents(value: Cents, divisor: number): Cents {
  if (!Number.isFinite(divisor) || divisor <= 0) return value
  return legacyCents(toDollars(value) / divisor)
}

/**
 * `$1234.56`, with no thousands separator.
 *
 * Deliberately not `toLocaleString`. These strings are baked into discount
 * labels that get stored in `pricing_snapshots` and rendered by the patient
 * pages, and the legacy code builds them with `toFixed(2)` — so a comma here
 * would be a difference in a financial record, showing up as a parity failure on
 * the first four-figure discount.
 */
export function formatUsd(value: Cents): string {
  return `$${toDollars(value).toFixed(2)}`
}
