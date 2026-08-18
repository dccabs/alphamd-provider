import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DraftMedication } from '../labReviews/reviewDraft.ts'
import { ANCILLARIES, PRODUCTS, testCatalog } from './__fixtures__/catalog.ts'
import { planProtocol, type ProtocolQuote } from './protocolPlan.ts'
import { ANCILLARY_ONLY, protocolData, snapshotRow } from './snapshot.ts'

/**
 * The two payloads, checked against the columns they are written into.
 *
 * The point of this file is key names. A wrong figure is caught by
 * `parity.test.ts`; a wrong *key* is silently dropped by PostgREST or rejected as
 * an unknown column, and either way the first person to notice is a patient
 * looking at a page with no price on it.
 */

const CATALOG = testCatalog()
const NOW = new Date('2026-08-17T15:00:00Z')

const med = (patch: Partial<DraftMedication> = {}): DraftMedication => ({
  medicationId: null,
  name: '',
  dose: '',
  sig: '',
  dosageMg: null,
  ...patch,
})

function quoteOf(medications: DraftMedication[]): ProtocolQuote {
  const plan = planProtocol(CATALOG, medications, NOW)
  assert.equal(plan.kind, 'quote')
  return plan.quote
}

const TESTOSTERONE = med({
  medicationId: PRODUCTS.cypionate.medicationId,
  name: 'Testosterone cypionate',
  dose: '160mg/week',
  sig: 'Inject .4mL subcutaneously every 3.5 days.',
  dosageMg: 160,
})

const HCG = med({
  medicationId: ANCILLARIES.hcg.medicationId,
  name: 'HCG',
  dose: '10,000 units',
})

/**
 * `pricing_snapshots`, as `information_schema` reports it.
 *
 * Transcribed rather than queried, because a unit test must not need a database —
 * which does mean this list can go stale. It goes stale *safely*: a column added
 * upstream makes no test fail and nothing is written to it, while a key this app
 * invents fails here rather than at the insert.
 */
const SNAPSHOT_COLUMNS = new Set([
  'id',
  'created_at',
  'created_by',
  'product_name',
  'dosage',
  'duration_months',
  'duration_label',
  'monthly_price',
  'addon_breakdown',
  'price_before_discounts',
  'discount_breakdown',
  'subtotal_monthly',
  'tax_rate',
  'tax_monthly',
  'total_monthly',
  'total_due_today',
  'next_billing_date',
  'product_id',
  'plan_id',
  'dosage_mg',
  'selected_addon_ids',
  'selected_discount_ids',
  'custom_addons',
  'custom_discounts',
  'monthly_discount_breakdown',
  'monthly_after_discounts',
  'overall_discount_breakdown',
  'billing_period_total',
  'subtotal_after_all_discounts',
  'tax_amount',
  'total_per_month',
  'ancillary_line_items',
  'ancillary_subtotal',
  'ancillary_tax_amount',
  'ancillary_total',
  'grand_total',
  'coupon_code_applied',
  // Added by this app's migration.
  'pricing_version',
])

/** The columns that would reject a null, so a shape with a hole in it fails here
 *  rather than at the insert. */
const REQUIRED = [
  'product_name',
  'duration_months',
  'monthly_price',
  'total_due_today',
  'ancillary_line_items',
  'ancillary_subtotal',
  'ancillary_tax_amount',
  'ancillary_total',
]

test('every key written is a real column', () => {
  const row = snapshotRow(quoteOf([TESTOSTERONE, HCG]), { createdBy: 'provider-uuid' })

  for (const key of Object.keys(row)) {
    assert.ok(SNAPSHOT_COLUMNS.has(key), `${key} is not a column on pricing_snapshots`)
  }
})

test('nothing NOT NULL is left null, even with no subscription', () => {
  for (const quote of [quoteOf([TESTOSTERONE]), quoteOf([HCG])]) {
    const row = snapshotRow(quote, { createdBy: 'provider-uuid' })

    for (const column of REQUIRED) {
      assert.notEqual(row[column], null, column)
      assert.notEqual(row[column], undefined, column)
    }
  }
})

test('a subscription is recorded in dollars, not cents', () => {
  const row = snapshotRow(quoteOf([TESTOSTERONE]), { createdBy: 'provider-uuid' })

  assert.equal(row.product_name, 'Testosterone Cypionate')
  assert.equal(row.product_id, PRODUCTS.cypionate.id)
  assert.equal(row.dosage, '160mg')
  assert.equal(row.dosage_mg, 160)
  assert.equal(row.duration_months, 1)
  assert.equal(row.duration_label, 'Monthly')
  assert.equal(row.monthly_price, 129)
  assert.equal(row.tax_rate, 0.065)
  assert.equal(row.tax_amount, 8.39)
  assert.equal(row.total_due_today, 137.39)
  assert.equal(row.grand_total, 137.39)
  assert.equal(row.next_billing_date, 'September 17, 2026')
  assert.equal(row.pricing_version, 'provider-v1')
  assert.equal(row.created_by, 'provider-uuid')
})

test('an add-on breakdown is stored as name and dollar amount', () => {
  const row = snapshotRow(
    quoteOf([{ ...TESTOSTERONE, dose: '250mg/week', dosageMg: 250 }]),
    { createdBy: 'provider-uuid' }
  )

  assert.deepEqual(row.addon_breakdown, [{ name: 'Dosage Surcharge', amount: 18.75 }])
})

test('a protocol with no subscription is recorded under the sentinel', () => {
  const row = snapshotRow(quoteOf([HCG]), { createdBy: 'provider-uuid' })

  // What `/pricing/[id]` keys its "one-time medications only" wording off.
  assert.equal(row.product_name, ANCILLARY_ONLY)
  assert.equal(row.product_id, null)
  assert.equal(row.dosage, 'N/A')
  assert.equal(row.duration_label, 'N/A')
  assert.equal(row.duration_months, 0)
  assert.equal(row.monthly_price, 0)
  assert.equal(row.total_due_today, 0)
  assert.equal(row.next_billing_date, null)

  assert.equal(row.ancillary_total, 300)
  assert.equal(row.grand_total, 300)
})

test('a quote from this portal never claims a discount was applied', () => {
  const row = snapshotRow(quoteOf([TESTOSTERONE]), { createdBy: 'provider-uuid' })

  // Empty because there is no picker, which is a gap rather than a decision —
  // hence `DISCOUNT_NOTICE` on the chart note.
  assert.deepEqual(row.selected_discount_ids, [])
  assert.deepEqual(row.custom_discounts, [])
  assert.deepEqual(row.monthly_discount_breakdown, [])
  assert.deepEqual(row.overall_discount_breakdown, [])
  assert.equal(row.coupon_code_applied, null)
})

test('the topical surcharge is recorded as a selection and the dose surcharge is not', () => {
  const cream = snapshotRow(
    quoteOf([
      med({
        medicationId: PRODUCTS.cream.medicationId,
        name: 'Testosterone cream (For males mostly)',
        dose: '2 clicks daily',
      }),
    ]),
    { createdBy: 'provider-uuid' }
  )
  assert.deepEqual(cream.selected_addon_ids, [4])

  const highDose = snapshotRow(
    quoteOf([{ ...TESTOSTERONE, dose: '250mg/week', dosageMg: 250 }]),
    { createdBy: 'provider-uuid' }
  )
  assert.deepEqual(highDose.selected_addon_ids, [])
})

test('an ancillary line is stored in the snake case the patient pages read', () => {
  const row = snapshotRow(quoteOf([HCG]), { createdBy: 'provider-uuid' })

  assert.deepEqual(row.ancillary_line_items, [
    {
      name: 'HCG 10,000 units',
      tier_label: null,
      quantity: null,
      unit_price: 300,
      processing_fee: 0,
      subtotal: 300,
      is_taxable: false,
      tax_rate: 0,
      tax_amount: 0,
    },
  ])
})

test('the protocol payload badges each medication by how it is charged', () => {
  const data = protocolData(quoteOf([TESTOSTERONE, HCG]), {
    snapshotId: 'snapshot-uuid',
    labReviewId: 'review-uuid',
  })

  assert.equal(data.snapshotId, 'snapshot-uuid')
  assert.deepEqual(data.medications, [
    {
      name: 'Testosterone cypionate',
      category: 'subscription',
      dosageSummary: { instructions: '160mg/week — Inject .4mL subcutaneously every 3.5 days.' },
    },
    {
      name: 'HCG',
      category: 'ancillary',
      dosageSummary: { instructions: '10,000 units' },
    },
  ])
})

test('the protocol payload records which review sent it', () => {
  const data = protocolData(quoteOf([TESTOSTERONE]), {
    snapshotId: 'snapshot-uuid',
    labReviewId: 'review-uuid',
  })

  assert.deepEqual(data.source, { labReview: 'review-uuid', pricingVersion: 'provider-v1' })
})
