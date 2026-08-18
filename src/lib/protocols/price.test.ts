import assert from 'node:assert/strict'
import test from 'node:test'

import type { Discount } from './discounts.ts'
import { cents, fromNumeric, toDollars } from './money.ts'
import {
  grandTotal,
  priceAncillaries,
  priceSubscription,
  type AncillarySelection,
  type SubscriptionInput,
} from './price.ts'

/** A fixed clock, so the billing date does not depend on the day this runs. */
const NOW = new Date('2026-08-17T18:00:00Z')

const protocol = (overrides: Partial<SubscriptionInput> = {}): SubscriptionInput => ({
  productName: 'Testosterone Cypionate',
  monthlyPrice: fromNumeric(129),
  durationMonths: 1,
  dosageMg: 100,
  isTaxable: false,
  taxRate: 0,
  addons: [],
  discounts: [],
  targetPrice: null,
  ...overrides,
})

const monthlyPct = (name: string, percent: number): Discount => ({
  kind: 'percentage',
  scope: 'monthly',
  label: `${name} (${percent}%)`,
  percent,
})

const ancillary = (overrides: Partial<AncillarySelection> = {}): AncillarySelection => ({
  name: 'Anastrozole',
  pricingModel: 'flat',
  basePrice: fromNumeric(40),
  processingFee: cents(0),
  isTaxable: false,
  taxRate: 0,
  tier: null,
  quantity: null,
  ...overrides,
})

test('a protocol with no discounts costs its monthly price', () => {
  const priced = priceSubscription(protocol(), NOW)

  assert.equal(toDollars(priced.priceBeforeDiscounts), 129)
  assert.equal(toDollars(priced.totalDueToday), 129)
  assert.equal(toDollars(priced.totalPerMonth), 129)
  assert.equal(priced.dosage, '100mg')
  assert.equal(priced.durationLabel, 'Monthly')
  assert.equal(priced.nextBillingDate, 'September 17, 2026')
})

test('a prepay plan is quoted for the whole term', () => {
  const priced = priceSubscription(protocol({ durationMonths: 6 }), NOW)

  assert.equal(toDollars(priced.billingPeriodTotal), 774)
  assert.equal(toDollars(priced.totalDueToday), 774)
  assert.equal(toDollars(priced.totalPerMonth), 129)
  assert.equal(priced.nextBillingDate, 'February 17, 2027')
})

test('an add-on is charged before discounts are taken', () => {
  const priced = priceSubscription(
    protocol({
      addons: [{ kind: 'flat', name: 'Extra vial', amount: fromNumeric(20) }],
      discounts: [monthlyPct('Military/First Responder', 20)],
    }),
    NOW
  )

  // 20% of 149, not of 129.
  assert.equal(toDollars(priced.priceBeforeDiscounts), 149)
  assert.equal(toDollars(priced.monthlyDiscountBreakdown[0].amount), 29.8)
  assert.equal(toDollars(priced.monthlyAfterDiscounts), 119.2)
})

// Dose-dependent pricing, which no snapshot can confirm: `addon_breakdown` keeps
// the resulting amount but not the threshold that produced it.
test('a per-unit add-on charges by whole units above the threshold', () => {
  const withDose = (dosageMg: number) =>
    priceSubscription(
      protocol({
        dosageMg,
        addons: [
          {
            kind: 'per_unit',
            name: 'High dose',
            pricePerUnit: fromNumeric(20),
            threshold: 200,
            unitSize: 50,
          },
        ],
      }),
      NOW
    )

  // On the threshold is not above it.
  assert.deepEqual(withDose(200).addonBreakdown, [])

  // A part unit is charged as a whole one.
  assert.equal(toDollars(withDose(210).addonBreakdown[0].amount), 20)
  assert.equal(toDollars(withDose(250).addonBreakdown[0].amount), 20)
  assert.equal(toDollars(withDose(251).addonBreakdown[0].amount), 40)
  assert.equal(toDollars(withDose(300).addonBreakdown[0].amount), 40)
})

test('a first-month coupon on a prepay plan is worth one month', () => {
  const priced = priceSubscription(
    protocol({
      durationMonths: 6,
      discounts: [
        {
          kind: 'percentage',
          scope: 'first_month',
          label: 'Coupon: HALFOFF (50% – first month only)',
          percent: 50,
        },
      ],
    }),
    NOW
  )

  // Half of one month's $129, not half of the $774 term.
  assert.equal(toDollars(priced.overallDiscountBreakdown[0].amount), 64.5)
  assert.equal(toDollars(priced.totalDueToday), 709.5)
})

// The reason target-price coupons are modelled apart from discounts: the
// recurring discount still applies, on top of the coupon's price.
test('a target-price coupon lets recurring discounts stack on the reduced month', () => {
  const priced = priceSubscription(
    protocol({
      discounts: [monthlyPct('Military/First Responder', 20)],
      targetPrice: { name: 'Coupon: WELCOME50', targetPrice: fromNumeric(99) },
    }),
    NOW
  )

  // 20% off $99 is $79.20, against the $103.20 the month would otherwise be.
  assert.deepEqual(
    priced.overallDiscountBreakdown.map((line) => [line.name, toDollars(line.amount)]),
    [['Coupon applied (WELCOME50): first month reduced to $79.20', 24]]
  )
  assert.equal(toDollars(priced.totalDueToday), 79.2)
})

test('a target-price coupon asking more than the protocol costs is ignored', () => {
  const priced = priceSubscription(
    protocol({ targetPrice: { name: 'Coupon: NOPE', targetPrice: fromNumeric(200) } }),
    NOW
  )

  assert.deepEqual(priced.overallDiscountBreakdown, [])
  assert.equal(toDollars(priced.totalDueToday), 129)
})

// A coupon that happens to land on the price already being charged is left off
// the record rather than shown as a $0.00 saving.
test('a target-price coupon worth nothing is not recorded', () => {
  const priced = priceSubscription(
    protocol({
      monthlyPrice: fromNumeric(129),
      // Cheaper than the list price, but the 100% discount already takes it to 0.
      discounts: [monthlyPct('Comped', 100)],
      targetPrice: { name: 'Coupon: MOOT', targetPrice: fromNumeric(99) },
    }),
    NOW
  )

  assert.deepEqual(priced.overallDiscountBreakdown, [])
  assert.equal(toDollars(priced.totalDueToday), 0)
})

test('discounts are taken monthly first, then against the term', () => {
  const priced = priceSubscription(
    protocol({
      durationMonths: 3,
      discounts: [
        monthlyPct('Military/First Responder', 20),
        { kind: 'fixed', scope: 'overall', label: 'Credit (-$25.00)', amount: fromNumeric(25) },
      ],
    }),
    NOW
  )

  assert.equal(toDollars(priced.monthlyAfterDiscounts), 103.2)
  assert.equal(toDollars(priced.billingPeriodTotal), 309.6)
  assert.equal(toDollars(priced.subtotalAfterAllDiscounts), 284.6)
  assert.equal(toDollars(priced.totalPerMonth), 94.87)
})

test('tax is taken on what is left after every discount', () => {
  const priced = priceSubscription(
    protocol({
      isTaxable: true,
      taxRate: 0.065,
      discounts: [monthlyPct('Military/First Responder', 20)],
    }),
    NOW
  )

  assert.equal(toDollars(priced.subtotalAfterAllDiscounts), 103.2)
  assert.equal(toDollars(priced.taxAmount), 6.71)
  assert.equal(toDollars(priced.totalDueToday), 109.91)
})

test('an untaxed product is untaxed whatever rate it carries', () => {
  const priced = priceSubscription(protocol({ isTaxable: false, taxRate: 0.065 }), NOW)

  assert.equal(priced.taxRate, 0)
  assert.equal(toDollars(priced.taxAmount), 0)
})

test('discounts cannot take a protocol below nothing', () => {
  const priced = priceSubscription(
    protocol({
      discounts: [
        { kind: 'fixed', scope: 'monthly', label: 'Credit (-$500.00/mo)', amount: fromNumeric(500) },
      ],
    }),
    NOW
  )

  assert.equal(toDollars(priced.monthlyAfterDiscounts), 0)
  assert.equal(toDollars(priced.totalDueToday), 0)
})

// How an ancillary-only quote comes out. The admin app writes the product name and
// the `N/A` duration label directly for these rather than deriving them.
test('a protocol with no term costs nothing and is not divided', () => {
  const priced = priceSubscription(
    protocol({ monthlyPrice: cents(0), durationMonths: 0, dosageMg: 0 }),
    NOW
  )

  assert.equal(toDollars(priced.totalDueToday), 0)
  assert.equal(toDollars(priced.totalPerMonth), 0)
  assert.equal(priced.dosage, 'N/A')
})

test('a provider’s own wording wins over the milligrams', () => {
  const priced = priceSubscription(
    protocol({ dosageMg: 93, dosageLabel: '2 clicks daily in the AM (~93mg/week)' }),
    NOW
  )

  assert.equal(priced.dosage, '2 clicks daily in the AM (~93mg/week)')
  assert.equal(priced.dosageMg, 93)
})

// ---------------------------------------------------------------------------
// Ancillaries
// ---------------------------------------------------------------------------

test('a flat ancillary costs its base price', () => {
  const priced = priceAncillaries([ancillary()])

  assert.equal(toDollars(priced.lines[0].subtotal), 40)
  assert.equal(toDollars(priced.total), 40)
})

test('a per-capsule ancillary is priced by quantity plus a fee', () => {
  const priced = priceAncillaries([
    ancillary({
      name: 'Enclomiphene',
      pricingModel: 'per_capsule',
      basePrice: cents(0),
      processingFee: fromNumeric(15),
      tier: { label: '12.5mg', price: fromNumeric(2.5), defaultQuantity: 30 },
      quantity: 30,
    }),
  ])

  const [line] = priced.lines
  assert.equal(line.tierLabel, '12.5mg')
  assert.equal(line.quantity, 30)
  assert.equal(toDollars(line.subtotal), 90)
})

test('a per-capsule ancillary falls back to the tier’s default quantity', () => {
  const priced = priceAncillaries([
    ancillary({
      pricingModel: 'per_capsule',
      processingFee: fromNumeric(15),
      tier: { label: '12.5mg', price: fromNumeric(2.5), defaultQuantity: 30 },
      quantity: null,
    }),
  ])

  assert.equal(priced.lines[0].quantity, 30)
  assert.equal(toDollars(priced.lines[0].subtotal), 90)
})

test('a tiered ancillary costs its tier price, with no quantity', () => {
  const priced = priceAncillaries([
    ancillary({
      pricingModel: 'tiered',
      tier: { label: '5mg', price: fromNumeric(65), defaultQuantity: null },
    }),
  ])

  assert.equal(priced.lines[0].quantity, null)
  assert.equal(toDollars(priced.lines[0].subtotal), 65)
})

test('an included ancillary is listed at no charge', () => {
  const priced = priceAncillaries([ancillary({ pricingModel: 'included' })])

  assert.equal(toDollars(priced.lines[0].subtotal), 0)
  assert.equal(priced.lines[0].tierLabel, null)
})

// A footgun preserved from the original rather than papered over: the item still
// appears on the quote, at nothing, and the patient is not charged for it.
test('a tiered ancillary chosen without a tier comes to nothing', () => {
  const priced = priceAncillaries([ancillary({ pricingModel: 'tiered', tier: null })])

  assert.equal(toDollars(priced.lines[0].subtotal), 0)
  assert.equal(priced.lines[0].tierLabel, null)
})

// Each ancillary carries its own rate, so the total is a sum of per-line tax
// rather than one rate over a subtotal.
test('ancillaries are taxed line by line', () => {
  const priced = priceAncillaries([
    ancillary({ name: 'Taxed', basePrice: fromNumeric(100), isTaxable: true, taxRate: 0.065 }),
    ancillary({ name: 'Untaxed', basePrice: fromNumeric(100), isTaxable: false, taxRate: 0.065 }),
  ])

  assert.equal(toDollars(priced.subtotal), 200)
  assert.equal(toDollars(priced.taxAmount), 6.5)
  assert.equal(toDollars(priced.total), 206.5)
})

test('nothing selected comes to nothing', () => {
  const priced = priceAncillaries([])

  assert.equal(toDollars(priced.total), 0)
  assert.deepEqual(priced.lines, [])
})

test('the grand total adds the subscription to the ancillaries', () => {
  const priced = priceSubscription(protocol(), NOW)
  const extras = priceAncillaries([ancillary()])

  assert.equal(toDollars(grandTotal(priced, extras)), 169)
  assert.equal(toDollars(grandTotal(priced, null)), 129)
  assert.equal(toDollars(grandTotal(null, extras)), 40)
  assert.equal(toDollars(grandTotal(null, null)), 0)
})
