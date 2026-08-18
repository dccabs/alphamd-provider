import assert from 'node:assert/strict'
import test from 'node:test'

import { ANCILLARIES, PRODUCTS, testCatalog } from './__fixtures__/catalog.ts'
import { toDollars } from './money.ts'
import { priceAncillaries, priceSubscription } from './price.ts'
import {
  activeTiers,
  ancillarySelection,
  isUnpriceable,
  needsTier,
  resolveMedication,
  subscriptionInput,
} from './resolve.ts'

const catalog = testCatalog()
const NOW = new Date('2026-08-17T18:00:00Z')

test('a subscription medication resolves to its plan product', () => {
  const resolved = resolveMedication(catalog, 1)

  assert.equal(resolved.kind, 'subscription')
  assert.equal(resolved.kind === 'subscription' && resolved.product.name, 'Testosterone Cypionate')
})

test('an ancillary medication resolves to its ancillary product', () => {
  const resolved = resolveMedication(catalog, 16)

  assert.equal(resolved.kind, 'ancillary')
  assert.equal(resolved.kind === 'ancillary' && resolved.product.name, 'HCG 10,000 units')
})

// The common case, and not an error. "Other" alone accounts for well over a
// hundred of the medications added in a month, and the right answer is to hand the
// protocol to staff rather than guess.
test('a medication the catalog does not price is reported, not guessed at', () => {
  const resolved = resolveMedication(catalog, 21)

  assert.deepEqual(resolved, { kind: 'unpriceable', reason: 'not-in-catalog', candidates: [] })
})

// Sermorelin is stocked twice at different prices because it depends on where the
// patient lives, and nothing in a lab review decides between them.
test('a medication stocked twice is ambiguous, with both names', () => {
  const resolved = resolveMedication(catalog, 31)

  assert.deepEqual(resolved, {
    kind: 'unpriceable',
    reason: 'ambiguous',
    candidates: ['Sermorelin (California)', 'Sermorelin (non California)'],
  })
})

// A different sentence in front of a provider: "we stopped selling this" rather
// than "we do not price this here".
test('a withdrawn product says so rather than looking missing', () => {
  const resolved = resolveMedication(catalog, 25)

  assert.deepEqual(resolved, {
    kind: 'unpriceable',
    reason: 'withdrawn',
    candidates: ['Anavar (Oxandrolone)'],
  })
})

test('the two enclomiphenes are separate medications and stay separate', () => {
  assert.equal(resolveMedication(catalog, 29).kind, 'subscription')
  assert.equal(resolveMedication(catalog, 33).kind, 'ancillary')
  assert.equal(resolveMedication(catalog, 34).kind, 'ancillary')
})

// The whole point of resolving through the plan: a twelve month term is $98 a
// month, and reading the product's own price would charge the $129 list price.
test('a prepay term is priced from its plan, not the list price', () => {
  const input = subscriptionInput(
    catalog,
    { product: PRODUCTS.cypionate, durationMonths: 12, dosageMg: 100 },
    NOW
  )

  assert.ok(!isUnpriceable(input))
  assert.equal(toDollars(input.monthlyPrice), 98)
  // $98 for twelve months, plus 6.5% tax on the $1176.
  assert.equal(toDollars(priceSubscription(input, NOW).totalDueToday), 1252.44)
})

test('a term the product is not sold on is refused', () => {
  const input = subscriptionInput(
    catalog,
    { product: PRODUCTS.enclomiphene, durationMonths: 3, dosageMg: 25 },
    NOW
  )

  assert.deepEqual(input, { unpriceable: 'no-plan-for-term' })
})

test('a resolved subscription carries its tax, add-ons and discounts', () => {
  const input = subscriptionInput(
    catalog,
    {
      product: PRODUCTS.cypionate,
      durationMonths: 1,
      dosageMg: 250,
      selectedDiscountIds: [1],
      selectedAddonIds: [5],
    },
    NOW
  )

  assert.ok(!isUnpriceable(input))
  assert.equal(input.isTaxable, true)
  assert.equal(input.taxRate, 0.065)

  const priced = priceSubscription(input, NOW)

  // $129, plus $50 of MCT oil, plus five 10mg units over 200 at $3.75.
  assert.deepEqual(
    priced.addonBreakdown.map((line) => [line.name, toDollars(line.amount)]),
    [
      ['Dosage Surcharge', 18.75],
      ['MCT Oil', 50],
    ]
  )
  assert.equal(toDollars(priced.priceBeforeDiscounts), 197.75)
  assert.equal(toDollars(priced.monthlyDiscountBreakdown[0].amount), 39.55)
})

test('a provider’s own dose wording is carried through', () => {
  const input = subscriptionInput(
    catalog,
    {
      product: PRODUCTS.cream,
      durationMonths: 1,
      dosageMg: 93,
      dosageLabel: '2 clicks daily in the AM (~93mg/week)',
    },
    NOW
  )

  assert.ok(!isUnpriceable(input))
  assert.equal(priceSubscription(input, NOW).dosage, '2 clicks daily in the AM (~93mg/week)')
})

test('a flat ancillary needs no tier', () => {
  assert.equal(needsTier(ANCILLARIES.hcg), false)

  const selection = ancillarySelection(ANCILLARIES.hcg)
  assert.ok(!isUnpriceable(selection))
  assert.equal(toDollars(priceAncillaries([selection]).total), 300)
})

test('an included ancillary is listed at no charge', () => {
  const selection = ancillarySelection(ANCILLARIES.anastrozole)

  assert.ok(!isUnpriceable(selection))
  assert.equal(toDollars(priceAncillaries([selection]).total), 0)
})

// The engine would return a $0.00 line here, which is the legacy behaviour and is
// preserved there. Catching it at resolution means the answer can still be "ask
// which strength" rather than a quote that gives the medication away.
test('a tiered ancillary with more than one tier is refused without a choice', () => {
  assert.equal(needsTier(ANCILLARIES.enclomipheneAncillary), true)
  assert.deepEqual(ancillarySelection(ANCILLARIES.enclomipheneAncillary), {
    unpriceable: 'tier-required',
  })
})

test('a chosen tier prices by quantity plus the processing fee', () => {
  const selection = ancillarySelection(ANCILLARIES.enclomipheneAncillary, {
    tierId: 10,
    quantity: 30,
  })

  assert.ok(!isUnpriceable(selection))

  const [line] = priceAncillaries([selection]).lines
  assert.equal(line.tierLabel, '12.5mg')
  assert.equal(toDollars(line.subtotal), 90)
})

test('a tier’s default quantity is used when none is given', () => {
  const selection = ancillarySelection(ANCILLARIES.enclomipheneAncillary, { tierId: 11 })

  assert.ok(!isUnpriceable(selection))

  const [line] = priceAncillaries([selection]).lines
  assert.equal(line.quantity, 30)
  assert.equal(toDollars(line.subtotal), 105)
})

// A product with exactly one tier has nothing to choose between, so requiring a
// choice would be ceremony.
test('a single-tier product resolves without being asked', () => {
  const selection = ancillarySelection(ANCILLARIES.enclomiphenePct)

  assert.ok(!isUnpriceable(selection))
  assert.equal(toDollars(priceAncillaries([selection]).total), 99)
})

test('an unknown tier is refused rather than silently defaulted', () => {
  assert.deepEqual(
    ancillarySelection(ANCILLARIES.enclomipheneAncillary, { tierId: 999 }),
    { unpriceable: 'tier-required' }
  )
})

test('only active tiers are offered', () => {
  const withRetired = {
    ...ANCILLARIES.enclomipheneAncillary,
    tiers: ANCILLARIES.enclomipheneAncillary.tiers.map((tier) =>
      tier.id === 10 ? { ...tier, isActive: false } : tier
    ),
  }

  assert.deepEqual(
    activeTiers(withRetired).map((tier) => tier.label),
    ['25mg']
  )
})
