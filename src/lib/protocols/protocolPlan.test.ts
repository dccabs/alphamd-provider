import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DraftMedication } from '../labReviews/reviewDraft.ts'
import { ANCILLARIES, PRODUCTS, testCatalog } from './__fixtures__/catalog.ts'
import { toDollars } from './money.ts'
import {
  DEFAULT_TERM_MONTHS,
  blockLine,
  planProtocol,
  type PricingBlock,
  type ProtocolQuote,
} from './protocolPlan.ts'

/**
 * What the medications in a review come to.
 *
 * The arithmetic is already held to 238 real snapshots by `parity.test.ts`, so
 * this file is about the decisions instead: which product a medication resolves
 * to, which add-ons apply without anyone asking, and — mostly — when the answer
 * has to be "a human prices this".
 */

const CATALOG = testCatalog()

/** Frozen so a billing date is a fact rather than a function of the test run. */
const NOW = new Date('2026-08-17T15:00:00Z')

const med = (patch: Partial<DraftMedication> = {}): DraftMedication => ({
  medicationId: null,
  name: '',
  dose: '',
  sig: '',
  dosageMg: null,
  ...patch,
})

/** Testosterone cypionate, as `NewMedicationPanel` records it. */
const cypionate = (weeklyMg: number) =>
  med({
    medicationId: PRODUCTS.cypionate.medicationId,
    name: 'Testosterone cypionate',
    dose: `${weeklyMg}mg/week`,
    sig: 'Inject .4mL subcutaneously every 3.5 days.',
    dosageMg: weeklyMg,
  })

function quoteOf(medications: DraftMedication[]): ProtocolQuote {
  const plan = planProtocol(CATALOG, medications, NOW)
  assert.equal(plan.kind, 'quote', `expected a quote, got ${plan.kind}`)
  return plan.quote
}

function blocksOf(medications: DraftMedication[]): PricingBlock[] {
  const plan = planProtocol(CATALOG, medications, NOW)
  assert.equal(plan.kind, 'blocked', `expected to be blocked, got ${plan.kind}`)
  return plan.blocks
}

test('a review with no medications has no protocol to send', () => {
  assert.deepEqual(planProtocol(CATALOG, [], NOW), { kind: 'none' })

  // A row added and never filled in is the same thing, and must not become a
  // blocked protocol that tells staff to price a medication with no name.
  assert.deepEqual(planProtocol(CATALOG, [med()], NOW), { kind: 'none' })
})

test('testosterone is quoted monthly at the plan price, not the list price', () => {
  const quote = quoteOf([cypionate(160)])

  assert.ok(quote.subscription)
  assert.equal(quote.subscription.productId, PRODUCTS.cypionate.id)
  assert.equal(quote.subscription.priced.durationMonths, DEFAULT_TERM_MONTHS)
  assert.equal(quote.subscription.priced.durationLabel, 'Monthly')
  assert.equal(toDollars(quote.subscription.priced.monthlyPrice), 129)
  assert.equal(quote.subscription.priced.dosage, '160mg')
  assert.equal(quote.subscription.priced.dosageMg, 160)

  // $129 plus 6.5% tax, and nothing else.
  assert.deepEqual(quote.subscription.priced.addonBreakdown, [])
  assert.equal(toDollars(quote.subscription.priced.taxAmount), 8.39)
  assert.equal(toDollars(quote.grandTotal), 137.39)
})

test('a dose above the threshold is surcharged without anyone selecting it', () => {
  const quote = quoteOf([cypionate(250)])

  assert.ok(quote.subscription)
  // Five 10mg units above 200, at $3.75 each.
  assert.deepEqual(
    quote.subscription.priced.addonBreakdown.map((line) => [line.name, toDollars(line.amount)]),
    [['Dosage Surcharge', 18.75]]
  )
  assert.equal(toDollars(quote.subscription.priced.priceBeforeDiscounts), 147.75)

  // Charged, but not recorded as a *selection* — which is what every historical
  // snapshot above 200mg does: the surcharge is in `addon_breakdown` and
  // `selected_addon_ids` is empty.
  assert.deepEqual(quote.subscription.addonIds, [])
})

test('a dose sitting exactly on the threshold is not surcharged', () => {
  const quote = quoteOf([cypionate(200)])

  assert.ok(quote.subscription)
  assert.deepEqual(quote.subscription.priced.addonBreakdown, [])
})

test('a topical carries its surcharge, and is recorded as having been selected', () => {
  const quote = quoteOf([
    med({
      medicationId: PRODUCTS.cream.medicationId,
      name: 'Testosterone cream (For males mostly)',
      dose: '2 clicks daily in the AM',
    }),
  ])

  assert.ok(quote.subscription)
  assert.deepEqual(
    quote.subscription.priced.addonBreakdown.map((line) => [line.name, toDollars(line.amount)]),
    [['Topical Surcharge', 50]]
  )
  // Unlike the dose surcharge, this one is a ticked box in the admin app, and all
  // 31 cream and gel snapshots record it as one.
  assert.deepEqual(quote.subscription.addonIds, [4])
})

test("a dose that is not a number of milligrams is quoted in the provider's words", () => {
  const quote = quoteOf([
    med({
      medicationId: PRODUCTS.cream.medicationId,
      name: 'Testosterone cream (For males mostly)',
      dose: '2 clicks daily in the AM',
    }),
  ])

  assert.ok(quote.subscription)
  // Not `0mg`, which is what falling back to the figure would have written.
  assert.equal(quote.subscription.priced.dosage, '2 clicks daily in the AM')
  assert.equal(quote.subscription.priced.dosageMg, 0)
})

test('an ancillary with one strength is priced without asking which', () => {
  const quote = quoteOf([
    med({
      medicationId: ANCILLARIES.enclomiphenePct.medicationId,
      name: 'Enclomiphene PCT',
      dose: '12.5mg × 30',
    }),
  ])

  assert.equal(quote.subscription, null)
  assert.deepEqual(quote.ancillaryProductIds, [ANCILLARIES.enclomiphenePct.id])
  assert.equal(toDollars(quote.grandTotal), 99)
})

test('a protocol of ancillaries alone is still a protocol', () => {
  const quote = quoteOf([
    med({ medicationId: ANCILLARIES.hcg.medicationId, name: 'HCG', dose: '10,000 units' }),
  ])

  assert.equal(quote.subscription, null)
  assert.equal(toDollars(quote.grandTotal), 300)
})

test('a subscription and its ancillaries are quoted together', () => {
  const quote = quoteOf([
    cypionate(160),
    med({
      medicationId: ANCILLARIES.anastrozole.medicationId,
      name: 'Anastrozole',
      dose: '1.00mg - Take 1/2 tablet (0.50mg) by mouth twice weekly.',
    }),
  ])

  assert.ok(quote.subscription)
  assert.deepEqual(quote.ancillaryProductIds, [ANCILLARIES.anastrozole.id])
  // Included at no charge, and listed so the patient can see it is covered.
  assert.equal(toDollars(quote.ancillaries.subtotal), 0)
  assert.equal(toDollars(quote.grandTotal), 137.39)
})

test('a medication typed in with no catalog row behind it is priced by hand', () => {
  const blocks = blocksOf([med({ name: 'Vitamin D', dose: '5000 IU daily' })])

  assert.deepEqual(blocks, [
    { medication: 'Vitamin D', dose: '5000 IU daily', reason: 'not-in-catalog', candidates: [] },
  ])
})

test('a medication the clinic does not price is priced by hand', () => {
  // `Other` is the commonest single addition in a month and is in no pricing
  // table, so this is the ordinary case rather than the exceptional one.
  const blocks = blocksOf([med({ medicationId: 9999, name: 'Other', dose: 'see note' })])

  assert.deepEqual(blocks.map((block) => block.reason), ['not-in-catalog'])
})

test('two products for one medication is a question only a human can answer', () => {
  const blocks = blocksOf([
    med({ medicationId: ANCILLARIES.sermorelinCalifornia.medicationId, name: 'Sermorelin' }),
  ])

  assert.equal(blocks[0].reason, 'ambiguous')
  // Both names, because the price depends on which and the difference is $35.
  assert.deepEqual(blocks[0].candidates.sort(), [
    'Sermorelin (California)',
    'Sermorelin (non California)',
  ])
})

test('a withdrawn medication says so rather than looking unpriced', () => {
  const blocks = blocksOf([med({ medicationId: ANCILLARIES.anavar.medicationId, name: 'Anavar' })])

  assert.equal(blocks[0].reason, 'withdrawn')
  assert.deepEqual(blocks[0].candidates, ['Anavar (Oxandrolone)'])
})

test('an ancillary sold at several strengths is not quoted at a guess', () => {
  const blocks = blocksOf([
    med({
      medicationId: ANCILLARIES.enclomipheneAncillary.medicationId,
      name: 'Enclomiphene',
      dose: '25mg daily',
    }),
  ])

  // The engine would return a $0.00 line for a tiered item with no tier, which is
  // the one outcome worth refusing outright.
  assert.equal(blocks[0].reason, 'tier-required')
})

test('a second recurring plan blocks the quote rather than being left off it', () => {
  const blocks = blocksOf([
    cypionate(160),
    med({
      medicationId: PRODUCTS.enclomiphene.medicationId,
      name: 'Enclomiphene (subscription)',
      dose: '12.5mg daily',
    }),
  ])

  assert.deepEqual(
    blocks.map((block) => [block.medication, block.reason]),
    [['Enclomiphene (subscription)', 'second-subscription']]
  )
})

test('one medication nobody can price blocks the whole quote', () => {
  // The point of the rule: testosterone on its own would price fine, but a quote
  // that silently omits the second medication is a total the patient would read
  // as covering both.
  const blocks = blocksOf([cypionate(160), med({ name: 'Other', dose: 'see note' })])

  assert.deepEqual(blocks.map((block) => block.medication), ['Other'])
})

test('every medication that cannot be priced is reported, not just the first', () => {
  const blocks = blocksOf([
    med({ name: 'Vitamin D' }),
    med({ medicationId: ANCILLARIES.anavar.medicationId, name: 'Anavar' }),
  ])

  assert.deepEqual(blocks.map((block) => block.reason), ['not-in-catalog', 'withdrawn'])
})

test('a product with no monthly term would be handed over rather than mispriced', () => {
  // Nothing in the catalog is in this state — every active product is sold
  // monthly — so this drives the branch through a product that is not.
  const quarterlyOnly = {
    ...PRODUCTS.enclomiphene,
    plans: PRODUCTS.enclomiphene.plans.filter((plan) => plan.durationMonths !== 1),
  }

  const plan = planProtocol(
    { ...CATALOG, subscriptions: [quarterlyOnly] },
    [med({ medicationId: quarterlyOnly.medicationId, name: 'Enclomiphene', dose: '12.5mg daily' })],
    NOW
  )

  assert.equal(plan.kind, 'blocked')
  assert.equal(plan.blocks[0].reason, 'no-plan-for-term')
})

test('a dose-priced product added without a dose is handed over, not charged zero', () => {
  // Also unreachable today, and also worth holding: the two products with a dose
  // surcharge are exactly the two the review doses in weekly milligrams. The day
  // that stops being true, this is the difference between declining and quoting
  // a surcharge of nothing.
  const plan = planProtocol(
    CATALOG,
    [med({ medicationId: PRODUCTS.cypionate.medicationId, name: 'Testosterone cypionate' })],
    NOW
  )

  assert.equal(plan.kind, 'blocked')
  assert.equal(plan.blocks[0].reason, 'dose-required')
})

test('a chosen catalog discount comes off the monthly price', () => {
  const quote = planProtocol(CATALOG, [cypionate(160)], NOW, { selectedDiscountIds: [1] })
  assert.equal(quote.kind, 'quote')
  assert.ok(quote.quote.subscription)
  assert.deepEqual(quote.quote.subscription.selectedDiscountIds, [1])
  assert.ok(quote.quote.subscription.priced.monthlyDiscountBreakdown.length > 0)
  assert.deepEqual(quote.quote.unusedDiscounts, [])
})

test('a discount the product cannot take stays unused and off the quote', () => {
  // Weight Loss Program is trt_only; Semaglutide is not TRT.
  const plan = planProtocol(
    CATALOG,
    [
      med({
        medicationId: PRODUCTS.semaglutide.medicationId,
        name: 'Semaglutide',
        dose: '0.25mg weekly',
      }),
    ],
    NOW,
    { selectedDiscountIds: [2] }
  )
  assert.equal(plan.kind, 'quote')
  assert.deepEqual(plan.quote.subscription?.selectedDiscountIds, [])
  assert.equal(plan.quote.unusedDiscounts[0]?.name, 'Weight Loss Program')
  assert.match(plan.quote.unusedDiscounts[0]?.reason ?? '', /not offered/)
})

test('the billing date comes from the clock it was given', () => {
  const quote = quoteOf([cypionate(160)])

  assert.ok(quote.subscription)
  assert.equal(quote.subscription.priced.nextBillingDate, 'September 17, 2026')
})

test('each block says what is in the way and stops', () => {
  const line = (patch: Partial<PricingBlock>) =>
    blockLine({ medication: 'Sermorelin', dose: '', reason: 'not-in-catalog', candidates: [], ...patch })

  assert.equal(
    line({ medication: 'Other', dose: 'see note' }),
    'Other (see note) — not priced automatically; quote it by hand.'
  )
  assert.match(
    line({ reason: 'ambiguous', candidates: ['Sermorelin (California)', 'Sermorelin (non California)'] }),
    /Sermorelin \(California\) or Sermorelin \(non California\)/
  )
  assert.match(line({ reason: 'withdrawn', candidates: ['Anavar'] }), /no longer sold/)
  assert.match(line({ reason: 'tier-required' }), /depends on the strength/)
  assert.match(line({ reason: 'dose-required' }), /depends on the dose/)
  assert.match(line({ reason: 'no-plan-for-term' }), /not sold monthly/)
  assert.match(line({ reason: 'second-subscription' }), /price it separately/)
})
