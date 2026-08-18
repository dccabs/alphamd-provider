import { clampZero, formatUsd, minCents, pctOf, subCents, type Cents } from './money.ts'

/**
 * Taking discounts off a balance, in the order the clinic's pricing has always
 * taken them.
 *
 * That order is "every percentage first, then every fixed amount, catalog before
 * custom within each", and each discount comes off what the previous one left.
 * It is not an arbitrary convention — it is worth real money. Taking 20% off $129
 * and then $30 leaves $73.20, while taking the $30 off first and then the 20%
 * leaves $79.20. Six dollars a month, on every protocol.
 *
 * The admin app writes that sequence out five times: once each for monthly and
 * overall discounts, doubled because catalog and custom discounts are looped
 * separately, and a fifth time in a helper that simulates the first month for
 * target-price coupons — where the copy carries a comment asking the next person
 * to keep it in sync by hand. Collapsing it to one function is most of the reason
 * this module exists.
 */

/**
 * Which balance a discount comes off.
 *
 * `monthly` recurs and is taken off the monthly price before it is multiplied out
 * over the billing period. `overall` comes off the billing period total once.
 * `first_month` also comes off the total once, but is *sized* against a single
 * month — see the note on `percentBase` below.
 *
 * Target-price coupons are deliberately absent: they set a price rather than
 * reduce one, so they are modelled separately in `price.ts` instead of being bent
 * into this shape.
 */
export type DiscountScope = 'monthly' | 'first_month' | 'overall'

/**
 * A discount ready to apply, with its label already rendered.
 *
 * The label is built up front, by `labels.ts`, because it depends only on the
 * discount's own configuration and never on the result. Keeping it out of here
 * leaves this module as arithmetic and nothing else — which matters, because the
 * labels are stored in `pricing_snapshots` and shown to patients, so they have
 * their own byte-for-byte tests.
 */
export type Discount =
  | { kind: 'percentage'; scope: DiscountScope; label: string; percent: number }
  | { kind: 'fixed'; scope: DiscountScope; label: string; amount: Cents }

/** A discount that was applied, and what it actually came to. */
export type AppliedDiscount = { name: string; amount: Cents }

export type AppliedDiscounts = {
  applied: AppliedDiscount[]
  remaining: Cents
}

/**
 * Percentages first, then fixed amounts, each off what the last one left.
 *
 * `discounts` must arrive in canonical order — catalog discounts sorted by
 * priority, then custom discounts in the order they were entered — because the
 * partition below is stable, and that is what reproduces the admin app's four
 * separate loops with one pass.
 *
 * A fixed discount is capped at the balance, so a $50 credit against a $30
 * balance takes $30 and is recorded as $30. A percentage is not capped, since it
 * cannot exceed the balance unless someone configures a discount above 100%.
 *
 * `percentBase` exists for one real asymmetry in the legacy chain. First-month
 * discounts are *deducted* from the billing period total but *sized* against a
 * single month's price, so a 50%-off coupon on a six-month prepay takes half of
 * one month, not half of the whole plan. Passing a base here reproduces that, and
 * it also means two such coupons are each sized against the same month rather
 * than compounding — so two 50% coupons take a whole month, not three quarters of
 * one. That is the existing behaviour, quirk included.
 */
export function applyDiscounts(
  base: Cents,
  discounts: Discount[],
  options: { percentBase?: Cents } = {}
): AppliedDiscounts {
  const applied: AppliedDiscount[] = []
  let remaining = base

  const percentages = discounts.filter((d) => d.kind === 'percentage')
  const fixed = discounts.filter((d) => d.kind === 'fixed')

  for (const discount of percentages) {
    const amount = pctOf(options.percentBase ?? remaining, discount.percent)
    applied.push({ name: discount.label, amount })
    remaining = subCents(remaining, amount)
  }

  for (const discount of fixed) {
    const amount = minCents(discount.amount, clampZero(remaining))
    applied.push({ name: discount.label, amount })
    remaining = subCents(remaining, amount)
  }

  return { applied, remaining }
}

/** What a set of applied discounts came to in total. */
export function discountTotal(applied: AppliedDiscount[]): Cents {
  return applied.reduce((sum, line) => sum + line.amount, 0) as Cents
}

/**
 * A fixed discount's configured value, as it appears inside a label.
 *
 * Split out because the labels put the *configured* amount on the page even when
 * the balance capped what was actually taken: a $50 credit against a $30 balance
 * still reads "-$50.00". Changing that would be a fair improvement and a
 * difference in a financial record, so it stays.
 */
export function fixedValueLabel(amount: Cents): string {
  return `-${formatUsd(amount)}`
}
