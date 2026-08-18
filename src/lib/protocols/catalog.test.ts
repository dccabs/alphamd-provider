import assert from 'node:assert/strict'
import test from 'node:test'

import { DISCOUNTS, PRODUCTS, testCatalog } from './__fixtures__/catalog.ts'
import {
  activePlans,
  addonsFor,
  automaticAddons,
  discountsFor,
  eligibleDiscounts,
  parseAncillaryProduct,
  parseCatalogDiscount,
  parseSubscriptionProduct,
  planFor,
  selectableAddons,
  toDiscount,
  type CatalogDiscount,
  type DiscountRow,
  type SubscriptionRow,
} from './catalog.ts'
import { fromNumeric, toDollars } from './money.ts'

const catalog = testCatalog()

test('a product’s terms come back in a stable order', () => {
  assert.deepEqual(
    activePlans(PRODUCTS.cypionate).map((plan) => plan.durationMonths),
    [1, 3, 6, 12]
  )
})

// The cream's three prepay plans all sit at sort_order 0 while its monthly plan
// sits at 1, so the monthly option genuinely sorts last — in the admin app too.
// Asserted rather than corrected: sort_order is the column staff use to arrange
// these, and quietly overriding it here would make the two apps disagree about
// which plan is presented first. The duration fallback is what stops the three
// tied plans coming back in whatever order the query happened to return.
test('terms respect sort order even where it reads oddly', () => {
  assert.deepEqual(
    activePlans(PRODUCTS.cream).map((plan) => plan.durationMonths),
    [3, 6, 12, 1]
  )
})

test('a term is priced from its own plan, not the list price', () => {
  assert.equal(toDollars(planFor(PRODUCTS.cypionate, 1)!.monthlyPrice), 129)
  assert.equal(toDollars(planFor(PRODUCTS.cypionate, 12)!.monthlyPrice), 98)
})

// Enclomiphene is sold monthly, six and twelve months. A missing term is a real
// answer, not a lookup failure.
test('a term the product is not sold on is null', () => {
  assert.equal(planFor(PRODUCTS.enclomiphene, 3), null)
  assert.equal(toDollars(planFor(PRODUCTS.enclomiphene, 6)!.monthlyPrice), 139)
  assert.equal(planFor(PRODUCTS.semaglutide, 6), null)
})

test('dose surcharges are separated from the optional extras', () => {
  assert.deepEqual(
    automaticAddons(PRODUCTS.cypionate).map((addon) => addon.name),
    ['Dosage Surcharge']
  )
  assert.deepEqual(
    selectableAddons(PRODUCTS.cypionate).map((addon) => addon.name),
    ['MCT Oil', 'Propionate']
  )
})

// The surcharge is the price of a dose above the included amount. Leaving it to a
// checkbox would mean a 250mg protocol could be sold at the 200mg price by
// forgetting to tick it.
test('a dose surcharge applies without being chosen', () => {
  const addons = addonsFor(PRODUCTS.cypionate, [])

  assert.equal(addons.length, 1)
  assert.deepEqual(addons[0], {
    kind: 'per_unit',
    name: 'Dosage Surcharge',
    pricePerUnit: fromNumeric(3.75),
    threshold: 200,
    unitSize: 10,
  })
})

test('an optional extra applies only when chosen', () => {
  assert.deepEqual(
    addonsFor(PRODUCTS.cypionate, [5]).map((addon) => addon.name),
    ['Dosage Surcharge', 'MCT Oil']
  )
  assert.deepEqual(
    addonsFor(PRODUCTS.cypionate, [5, 6]).map((addon) => addon.name),
    ['Dosage Surcharge', 'MCT Oil', 'Propionate']
  )
})

// Eligibility is matched on the product *name*, so these assertions are also a
// statement that renaming a product changes who qualifies.
test('a testosterone product is offered every discount', () => {
  assert.deepEqual(
    eligibleDiscounts(catalog, PRODUCTS.cypionate).map((discount) => discount.id),
    [1, 6, 2, 3, 4, 5]
  )
})

test('enclomiphene is offered the hormone therapy discounts but not the TRT ones', () => {
  const offered = eligibleDiscounts(catalog, PRODUCTS.enclomiphene).map((d) => d.name)

  assert.ok(offered.includes('Military/First Responder'))
  assert.ok(offered.includes('Newsletter (first month only)'))
  assert.ok(!offered.includes('Weight Loss Program'), 'Weight Loss is trt_only')
  assert.ok(!offered.includes('Female TRT'), 'Female TRT is trt_only')
})

test('a product outside hormone therapy is offered only the open discounts', () => {
  assert.deepEqual(
    eligibleDiscounts(catalog, PRODUCTS.semaglutide).map((discount) => discount.name),
    ['Household/Spouses', 'Friends/Family']
  )
})

// Priority decides which discount comes off which balance, and stacking is worth
// money — see the note at the top of discounts.ts.
test('discounts come back in priority order', () => {
  const monthly = eligibleDiscounts(catalog, PRODUCTS.cypionate).filter(
    (discount) => discount.scope === 'monthly'
  )

  assert.deepEqual(
    monthly.map((discount) => discount.priority),
    [1, 2, 3, 4, 5]
  )
})

test('an inactive discount is never offered', () => {
  const withRetired = {
    ...catalog,
    discounts: catalog.discounts.map((d) => (d.id === 1 ? { ...d, isActive: false } : d)),
  }

  assert.ok(!eligibleDiscounts(withRetired, PRODUCTS.cypionate).some((d) => d.id === 1))
})

// Latent rather than observed: nothing in the catalog carries a date today.
test('an expired discount is not offered', () => {
  const expiring: CatalogDiscount = { ...DISCOUNTS[0], expiresAt: '2026-08-01T00:00:00Z' }
  const withExpiry = { ...catalog, discounts: [expiring] }

  const before = new Date('2026-07-01T00:00:00Z')
  const after = new Date('2026-09-01T00:00:00Z')

  assert.equal(eligibleDiscounts(withExpiry, PRODUCTS.cypionate, before).length, 1)
  assert.equal(eligibleDiscounts(withExpiry, PRODUCTS.cypionate, after).length, 0)
})

test('only the chosen discounts are priced', () => {
  const chosen = discountsFor(catalog, PRODUCTS.cypionate, [1, 4])

  assert.deepEqual(chosen.map((discount) => discount.label), [
    'Military/First Responder (20%)',
    'Friends/Family (-$30.00/mo)',
  ])
})

test('choosing a discount the product is not eligible for prices nothing', () => {
  // Weight Loss Program is trt_only.
  assert.deepEqual(discountsFor(catalog, PRODUCTS.semaglutide, [2]), [])
})

test('a catalog discount carries the label its scope calls for', () => {
  const monthly = toDiscount(DISCOUNTS[0])
  const overall = toDiscount(DISCOUNTS[5])

  assert.deepEqual(monthly, {
    kind: 'percentage',
    scope: 'monthly',
    label: 'Military/First Responder (20%)',
    percent: 20,
  })

  // The name contains "(first month only)" but the scope is overall, so the label
  // takes the plain suffix. This is a real row, and the reason the parity replay
  // anchors its patterns to the end of the string.
  assert.deepEqual(overall, {
    kind: 'fixed',
    scope: 'overall',
    label: 'Newsletter (first month only) (-$30.00)',
    amount: fromNumeric(30),
  })
})

test('a first-month discount takes the coupon wording', () => {
  const coupon: CatalogDiscount = { ...DISCOUNTS[0], scope: 'first_month' }

  assert.equal(
    toDiscount(coupon).label,
    'Military/First Responder (20% – first month only)'
  )
})

// ---------------------------------------------------------------------------
// Reading the rows
// ---------------------------------------------------------------------------

const subscriptionRow = (): SubscriptionRow => ({
  id: 1,
  medication_id: 1,
  name: 'Testosterone Cypionate',
  base_monthly_price: '129.00',
  is_taxable: true,
  tax_rate: '0.065',
  is_active: true,
  subscription_prepayment_plans: [
    {
      id: 4,
      duration_months: 12,
      monthly_price: '98.00',
      label: 'Pay 12 Months',
      sort_order: 4,
      is_active: true,
    },
  ],
  subscription_addons: [
    {
      id: 1,
      name: 'Dosage Surcharge',
      addon_type: 'per_unit',
      price_per_unit: '3.75',
      threshold: '200',
      unit_size: '10',
      is_active: true,
    },
  ],
})

// PostgREST is entitled to hand a `numeric` column back as a string, and does for
// some clients. Every price on this path would be NaN if that were assumed away.
test('numeric columns are read whether they arrive as strings or numbers', () => {
  const fromStrings = parseSubscriptionProduct(subscriptionRow())
  const fromNumbers = parseSubscriptionProduct({
    ...subscriptionRow(),
    base_monthly_price: 129,
    tax_rate: 0.065,
    subscription_prepayment_plans: [
      {
        id: 4,
        duration_months: 12,
        monthly_price: 98,
        label: 'Pay 12 Months',
        sort_order: 4,
        is_active: true,
      },
    ],
  })

  assert.equal(toDollars(fromStrings.baseMonthlyPrice), 129)
  assert.equal(fromStrings.taxRate, 0.065)
  assert.equal(toDollars(fromStrings.plans[0].monthlyPrice), 98)
  assert.deepEqual(fromNumbers.plans, fromStrings.plans)
})

test('a product with no plans or add-ons reads as empty, not missing', () => {
  const bare = parseSubscriptionProduct({
    ...subscriptionRow(),
    subscription_prepayment_plans: [],
    subscription_addons: [],
  })

  assert.deepEqual(bare.plans, [])
  assert.deepEqual(activePlans(bare), [])
  assert.deepEqual(addonsFor(bare), [])
})

// A threshold of zero and no threshold at all are different things: the first
// charges from the first milligram, the second means the column was never set.
test('an absent threshold stays absent rather than becoming zero', () => {
  const row = subscriptionRow()
  row.subscription_addons[0].threshold = null
  row.subscription_addons[0].unit_size = null

  const product = parseSubscriptionProduct(row)

  assert.equal(product.addons[0].threshold, null)
  assert.equal(product.addons[0].unitSize, null)

  // The engine needs numbers, so `addonsFor` fills them in — charging from the
  // first milligram, in whole units of one.
  assert.deepEqual(addonsFor(product), [
    {
      kind: 'per_unit',
      name: 'Dosage Surcharge',
      pricePerUnit: fromNumeric(3.75),
      threshold: 0,
      unitSize: 1,
    },
  ])
})

test('an unrecognised add-on type falls back to the column default', () => {
  const row = subscriptionRow()
  row.subscription_addons[0].addon_type = 'sometimes'

  assert.equal(parseSubscriptionProduct(row).addons[0].addonType, 'per_unit')
})

test('an unrecognised pricing model falls back to a flat charge', () => {
  const product = parseAncillaryProduct({
    id: 1,
    medication_id: 16,
    name: 'HCG 10,000 units',
    pricing_model: 'who knows',
    base_price: '300',
    processing_fee: '0',
    is_taxable: false,
    tax_rate: '0',
    is_active: true,
    sort_order: 0,
    ancillary_pricing_tiers: [],
  })

  assert.equal(product.pricingModel, 'flat')
  assert.equal(toDollars(product.basePrice), 300)
})

const discountRow = (overrides: Partial<DiscountRow> = {}): DiscountRow => ({
  id: 1,
  name: 'Military/First Responder',
  code: null,
  discount_type: 'percentage',
  value: '20',
  applies_to: 'hormone_therapy',
  scope: 'monthly',
  priority: 1,
  is_active: true,
  expiration_date: null,
  ...overrides,
})

test('a discount is read as a percentage or an amount, never both', () => {
  const percentage = parseCatalogDiscount(discountRow())
  const fixed = parseCatalogDiscount(discountRow({ discount_type: 'fixed', value: '30' }))

  assert.deepEqual(percentage, {
    id: 1,
    name: 'Military/First Responder',
    code: null,
    appliesTo: 'hormone_therapy',
    scope: 'monthly',
    priority: 1,
    isActive: true,
    expiresAt: null,
    kind: 'percentage',
    percent: 20,
  })
  assert.equal(fixed.kind === 'fixed' && toDollars(fixed.amount), 30)
})

// The one fallback that is deliberately not the column's default. An unreadable
// audience should mean a discount nobody is offered — noticed when someone asks
// why it is missing — rather than one everybody is, found later in the takings.
test('an unreadable audience narrows rather than widens', () => {
  assert.equal(parseCatalogDiscount(discountRow({ applies_to: 'everyone!' })).appliesTo, 'trt_only')
  assert.equal(parseCatalogDiscount(discountRow({ applies_to: null })).appliesTo, 'trt_only')
})

test('an unreadable scope falls back to a recurring discount', () => {
  assert.equal(parseCatalogDiscount(discountRow({ scope: 'quarterly' })).scope, 'monthly')
  assert.equal(parseCatalogDiscount(discountRow({ scope: null })).scope, 'monthly')
})
