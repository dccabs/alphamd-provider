import {
  applyDiscounts,
  discountTotal,
  type AppliedDiscount,
  type Discount,
} from './discounts.ts'
import {
  addCents,
  clampZero,
  divideCents,
  minCents,
  rateOf,
  subCents,
  timesCents,
  toDollars,
  type Cents,
} from './money.ts'
import {
  addonLabel,
  dosageLabel,
  durationLabel,
  nextBillingDateLabel,
  targetPriceLabel,
} from './labels.ts'

/**
 * What a protocol costs.
 *
 * A transcription of the admin app's `calculateSubscriptionPricing` and
 * `calculateAncillaryPricing`, in whole cents, with the ordering rules pulled out
 * into `discounts.ts` and the stored strings into `labels.ts`. It is held to the
 * original by replaying 238 real snapshots against it — see `parity.test.ts` —
 * so the intent is to reproduce those results exactly, quirks included, not to
 * improve on them.
 *
 * Pure. No catalog lookups, no clock of its own, no database. `now` is a
 * parameter because the only date it produces, the next billing date, would
 * otherwise make the function untestable and its output dependent on the minute
 * it ran.
 */

/** A named amount on a quote, which is how the breakdowns are stored. */
export type LineItem = { name: string; amount: Cents }

/**
 * A charge on top of the monthly price.
 *
 * `per_unit` is how dose-dependent pricing works: above `threshold` milligrams,
 * every `unitSize` further milligrams costs `pricePerUnit`, rounded *up* to the
 * next whole unit, so 210mg against a 200mg threshold in 50mg units is charged as
 * one unit rather than a fifth of one.
 */
export type Addon =
  | { kind: 'flat'; name: string; amount: Cents }
  | {
      kind: 'per_unit'
      name: string
      pricePerUnit: Cents
      threshold: number
      unitSize: number
    }

/**
 * A coupon that sets the first month's price instead of reducing it.
 *
 * Modelled apart from `Discount` because it behaves differently in kind: the
 * quoted price is re-derived from the coupon's target and the difference becomes a
 * one-off reduction, so recurring discounts still stack on top of the reduced
 * first month the way they did before this was a coupon at all.
 */
export type TargetPriceCoupon = { name: string; targetPrice: Cents }

export type SubscriptionInput = {
  productName: string
  monthlyPrice: Cents
  durationMonths: number
  dosageMg: number
  /**
   * What the patient is told to do, when that is not simply a number of
   * milligrams. Cream is dosed in pump clicks. Left unset, the dose is written
   * out as `${dosageMg}mg`.
   */
  dosageLabel?: string | null
  isTaxable: boolean
  taxRate: number
  addons: Addon[]
  /** Canonical order: catalog discounts by priority, then custom ones. */
  discounts: Discount[]
  targetPrice: TargetPriceCoupon | null
}

/**
 * A priced subscription, in the shape a `pricing_snapshots` row records.
 *
 * Every money field is cents; the writer converts at the boundary.
 */
export type PricedSubscription = {
  productName: string
  dosage: string
  dosageMg: number
  durationMonths: number
  durationLabel: string
  monthlyPrice: Cents
  addonBreakdown: LineItem[]
  priceBeforeDiscounts: Cents
  monthlyDiscountBreakdown: AppliedDiscount[]
  monthlyAfterDiscounts: Cents
  billingPeriodTotal: Cents
  overallDiscountBreakdown: AppliedDiscount[]
  subtotalAfterAllDiscounts: Cents
  taxRate: number
  taxAmount: Cents
  totalDueToday: Cents
  totalPerMonth: Cents
  nextBillingDate: string
}

/**
 * The add-ons that apply at a given dose, and what each comes to.
 *
 * Exported because history cannot check it: `addon_breakdown` stores the
 * resulting `{ name, amount }` but not the threshold or unit size that produced
 * it, so a snapshot can confirm the arithmetic downstream of an add-on without
 * saying anything about whether the add-on should have applied. That gap is
 * covered by unit tests instead.
 */
export function applicableAddons(addons: Addon[], dosageMg: number): LineItem[] {
  const lines: LineItem[] = []

  for (const addon of addons) {
    if (addon.kind === 'flat') {
      lines.push({ name: addonLabel(addon.name), amount: addon.amount })
      continue
    }

    // Strictly above the threshold: a dose sitting exactly on it is not charged.
    if (dosageMg <= addon.threshold) continue

    const unitSize = addon.unitSize > 0 ? addon.unitSize : 1
    const units = Math.ceil((dosageMg - addon.threshold) / unitSize)

    lines.push({
      name: addonLabel(addon.name),
      amount: timesCents(addon.pricePerUnit, units),
    })
  }

  return lines
}

function ofScope(discounts: Discount[], scope: Discount['scope']): Discount[] {
  return discounts.filter((discount) => discount.scope === scope)
}

export function priceSubscription(
  input: SubscriptionInput,
  now: Date = new Date()
): PricedSubscription {
  // 1. The monthly price, plus whatever the dose adds to it.
  const addonBreakdown = applicableAddons(input.addons, input.dosageMg)
  const priceBeforeDiscounts = addCents(
    input.monthlyPrice,
    ...addonBreakdown.map((line) => line.amount)
  )

  // 2. Recurring discounts, off the monthly price.
  const monthly = ofScope(input.discounts, 'monthly')
  const recurring = applyDiscounts(priceBeforeDiscounts, monthly)
  const monthlyAfterDiscounts = clampZero(recurring.remaining)

  // 3. Multiplied out over the term. A prepay plan is quoted in full up front.
  const billingPeriodTotal = timesCents(monthlyAfterDiscounts, input.durationMonths)

  // 4. One-off reductions, off the billing period total. Three groups, in this
  //    order, because it decides how they stack.
  const overallDiscountBreakdown: AppliedDiscount[] = []
  let runningTotal = billingPeriodTotal

  //    4a. A target-price coupon, which is worth the difference between the
  //        normal monthly subtotal and the same discounts applied to the
  //        coupon's price. Skipped when the coupon asks for more than the
  //        protocol already costs.
  if (input.targetPrice && input.targetPrice.targetPrice < priceBeforeDiscounts) {
    const firstMonth = clampZero(applyDiscounts(input.targetPrice.targetPrice, monthly).remaining)
    const worth = clampZero(subCents(monthlyAfterDiscounts, firstMonth))
    const amount = minCents(worth, clampZero(runningTotal))

    // A coupon worth nothing is left off the record entirely rather than shown
    // as a $0.00 line.
    if (amount > 0) {
      overallDiscountBreakdown.push({
        name: targetPriceLabel(input.targetPrice.name, firstMonth),
        amount,
      })
      runningTotal = subCents(runningTotal, amount)
    }
  }

  //    4b. First-month coupons, sized against a single month even on a prepay
  //        plan. See the note on `percentBase` in `discounts.ts`.
  const firstMonth = applyDiscounts(runningTotal, ofScope(input.discounts, 'first_month'), {
    percentBase: monthlyAfterDiscounts,
  })
  overallDiscountBreakdown.push(...firstMonth.applied)
  runningTotal = firstMonth.remaining

  //    4c. Discounts against the whole term.
  const overall = applyDiscounts(runningTotal, ofScope(input.discounts, 'overall'))
  overallDiscountBreakdown.push(...overall.applied)
  runningTotal = overall.remaining

  const subtotalAfterAllDiscounts = clampZero(runningTotal)

  // 5. Tax, on what is left after everything.
  const taxRate = input.isTaxable ? input.taxRate : 0
  const taxAmount = rateOf(subtotalAfterAllDiscounts, taxRate)

  // 6. What the patient is charged now, and what that works out to per month.
  const totalDueToday = addCents(subtotalAfterAllDiscounts, taxAmount)
  const totalPerMonth =
    input.durationMonths > 0 ? divideCents(totalDueToday, input.durationMonths) : totalDueToday

  return {
    productName: input.productName,
    dosage: dosageLabel(input.dosageMg, input.dosageLabel),
    dosageMg: input.dosageMg,
    durationMonths: input.durationMonths,
    durationLabel: durationLabel(input.durationMonths),
    monthlyPrice: input.monthlyPrice,
    addonBreakdown,
    priceBeforeDiscounts,
    monthlyDiscountBreakdown: recurring.applied,
    monthlyAfterDiscounts,
    billingPeriodTotal,
    overallDiscountBreakdown,
    subtotalAfterAllDiscounts,
    taxRate,
    taxAmount,
    totalDueToday,
    totalPerMonth,
    nextBillingDate: nextBillingDateLabel(now, input.durationMonths),
  }
}

/** What the recurring discounts came to, for callers that want the figure. */
export function monthlyDiscountTotal(priced: PricedSubscription): Cents {
  return discountTotal(priced.monthlyDiscountBreakdown)
}

// ---------------------------------------------------------------------------
// Ancillaries
// ---------------------------------------------------------------------------

/**
 * How an ancillary is priced.
 *
 *   `flat`              a single fixed cost
 *   `per_capsule`       a tier price per unit, times quantity, plus a fee
 *   `tiered`            a flat cost for the chosen tier
 *   `included`          no charge, listed so the patient knows it is covered
 *   `external_referral` a referral fee, listed for information
 */
export type AncillaryPricingModel =
  | 'flat'
  | 'per_capsule'
  | 'tiered'
  | 'included'
  | 'external_referral'

export type AncillarySelection = {
  name: string
  pricingModel: AncillaryPricingModel
  basePrice: Cents
  processingFee: Cents
  isTaxable: boolean
  taxRate: number
  tier: { label: string; price: Cents; defaultQuantity: number | null } | null
  quantity: number | null
}

export type AncillaryLine = {
  name: string
  tierLabel: string | null
  quantity: number | null
  unitPrice: Cents
  processingFee: Cents
  subtotal: Cents
  isTaxable: boolean
  taxRate: number
  taxAmount: Cents
}

export type PricedAncillaries = {
  lines: AncillaryLine[]
  subtotal: Cents
  taxAmount: Cents
  total: Cents
}

/**
 * A tiered ancillary chosen without a tier comes to nothing.
 *
 * That is the legacy behaviour, and it is a real footgun rather than a
 * defensive default: the item still appears on the quote, at $0.00, and the
 * patient is not charged for it. Whether a selection is complete is a question
 * for validation before pricing, not for this function to paper over — but it is
 * worth knowing about before anyone reads a $0 line as "included".
 */
function priceOne(selection: AncillarySelection): AncillaryLine {
  let unitPrice: Cents = 0 as Cents
  let processingFee: Cents = 0 as Cents
  let subtotal: Cents = 0 as Cents
  let tierLabel: string | null = null
  let quantity: number | null = null

  switch (selection.pricingModel) {
    case 'flat':
    case 'external_referral': {
      unitPrice = selection.basePrice
      subtotal = unitPrice
      break
    }

    case 'per_capsule': {
      if (!selection.tier) break
      tierLabel = selection.tier.label
      unitPrice = selection.tier.price
      quantity = selection.quantity ?? selection.tier.defaultQuantity ?? 1
      processingFee = selection.processingFee
      subtotal = addCents(timesCents(unitPrice, quantity), processingFee)
      break
    }

    case 'tiered': {
      if (!selection.tier) break
      tierLabel = selection.tier.label
      unitPrice = selection.tier.price
      subtotal = unitPrice
      break
    }

    case 'included':
      break
  }

  const taxRate = selection.isTaxable ? selection.taxRate : 0

  return {
    name: selection.name,
    tierLabel,
    quantity,
    unitPrice,
    processingFee,
    subtotal,
    isTaxable: selection.isTaxable,
    taxRate,
    taxAmount: rateOf(subtotal, taxRate),
  }
}

/**
 * Ancillaries priced independently and summed.
 *
 * Each carries its own tax rate, because some are taxable and some are not, so
 * the total is a sum of per-line tax rather than a rate applied to a subtotal.
 */
export function priceAncillaries(selections: AncillarySelection[]): PricedAncillaries {
  const lines = selections.map(priceOne)

  const subtotal = addCents(...lines.map((line) => line.subtotal))
  const taxAmount = addCents(...lines.map((line) => line.taxAmount))

  return { lines, subtotal, taxAmount, total: addCents(subtotal, taxAmount) }
}

/**
 * A line item in the shape `pricing_snapshots.ancillary_line_items` stores.
 *
 * Snake case and dollars, because alphamd's pricing and protocol pages read
 * these keys straight out of the jsonb. Kept here beside the type it converts so
 * the two cannot drift, and so the parity replay checks the shape that is
 * actually written rather than an intermediate one.
 */
export function ancillaryLineJson(line: AncillaryLine): Record<string, unknown> {
  return {
    name: line.name,
    tier_label: line.tierLabel,
    quantity: line.quantity,
    unit_price: toDollars(line.unitPrice),
    processing_fee: toDollars(line.processingFee),
    subtotal: toDollars(line.subtotal),
    is_taxable: line.isTaxable,
    tax_rate: line.taxRate,
    tax_amount: toDollars(line.taxAmount),
  }
}

/**
 * What the patient pays today for the subscription and the ancillaries together.
 *
 * `grand_total` on the snapshot, and the figure the payment is taken for.
 */
export function grandTotal(
  subscription: Pick<PricedSubscription, 'totalDueToday'> | null,
  ancillaries: Pick<PricedAncillaries, 'total'> | null
): Cents {
  return addCents(subscription?.totalDueToday ?? (0 as Cents), ancillaries?.total ?? (0 as Cents))
}
