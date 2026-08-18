import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import type { Discount } from './discounts.ts'
import {
  ancillaryLineJson,
  priceAncillaries,
  priceSubscription,
  type AncillarySelection,
  type Addon,
  type SubscriptionInput,
  type TargetPriceCoupon,
} from './price.ts'
import { fromNumeric, toDollars, type Cents } from './money.ts'

/**
 * The engine, replayed against every protocol the clinic has actually priced.
 *
 * A rewrite of money math cannot be verified by reading it. `pricing_snapshots`
 * records the inputs a protocol was priced from alongside the outputs that were
 * computed, so each row is a worked example with the answer in the back: rebuild
 * the inputs, run them through this engine, and every figure has to land on the
 * same cent.
 *
 * What it proves, and what it does not:
 *
 *   - The arithmetic chain, in full — add-ons through to the grand total — plus
 *     the ordering of discounts and the exact text of every stored label.
 *   - *Not* whether an add-on should have applied, or a discount been offered.
 *     `addon_breakdown` records that an add-on came to $20 but not the threshold
 *     that decided it, so those are reconstructed as flat amounts here and their
 *     applicability is covered by unit tests in `price.test.ts` instead. A failure
 *     in this file is an arithmetic or formatting regression; it is never a
 *     catalog question.
 *
 * Regenerate the fixture with `scripts/dump-pricing-fixture.ts`.
 */

type StoredLine = { name: string; amount: number | string }

type StoredCustomDiscount = {
  name: string | null
  type: 'percentage' | 'fixed'
  scope: 'monthly' | 'first_month' | 'overall' | 'target_price'
  value: number
}

type SnapshotRow = {
  tag: 'recent' | 'prepay-tail'
  id: string
  created_at: string
  product_name: string
  dosage: string | null
  duration_months: number
  duration_label: string | null
  monthly_price: number | null
  addon_breakdown: StoredLine[] | null
  price_before_discounts: number | null
  tax_rate: number | null
  total_due_today: number | null
  next_billing_date: string | null
  dosage_mg: number | null
  custom_discounts: StoredCustomDiscount[] | null
  monthly_discount_breakdown: StoredLine[] | null
  monthly_after_discounts: number | null
  overall_discount_breakdown: StoredLine[] | null
  billing_period_total: number | null
  subtotal_after_all_discounts: number | null
  tax_amount: number | null
  total_per_month: number | null
  ancillary_line_items: Record<string, unknown>[] | null
  ancillary_subtotal: number | null
  ancillary_tax_amount: number | null
  ancillary_total: number | null
  grand_total: number | null
}

const fixture = JSON.parse(
  readFileSync(new URL('./__fixtures__/snapshots.json', import.meta.url), 'utf8')
) as { generatedAt: string; recentSince: string; rows: SnapshotRow[] }

/**
 * The sentinel the admin app writes when a quote is ancillaries only.
 *
 * These rows never went through the subscription calculator at all: the product
 * name, a zero price, a zero duration and the `N/A` duration label are written
 * directly. Worth knowing when the writer is built, because `durationLabel(0)`
 * produces `0 Months`, not `N/A` — the sentinel has to be written, not derived.
 */
const ANCILLARY_ONLY = 'Ancillary Only'

/** U+2013, which is what the first-month labels use. Not a hyphen. */
const EN_DASH = '\u2013'

const PERCENT = /^(.*) \((\d+(?:\.\d+)?)%\)$/
const MONTHLY_FIXED = /^(.*) \(-\$([\d.]+)\/mo\)$/
const OVERALL_FIXED = /^(.*) \(-\$([\d.]+)\)$/
const FIRST_MONTH_PERCENT = new RegExp(`^(.*) \\((\\d+(?:\\.\\d+)?)% ${EN_DASH} first month only\\)$`)
const FIRST_MONTH_FIXED = new RegExp(`^(.*) \\(-\\$([\\d.]+) ${EN_DASH} first month only\\)$`)
const TARGET_PRICE = /: first month reduced to \$[\d.]+$/

/**
 * A stored breakdown line, read back as the discount that produced it.
 *
 * The labels are the only record of how a catalog discount was configured — the
 * snapshot keeps the id but not the percentage — so the configuration is parsed
 * back out of the text. That makes this a test of `labels.ts` as much as of the
 * arithmetic: a label rebuilt from a parsed label has to come out byte for byte
 * identical, across all 238 rows, or the round trip breaks.
 *
 * The fixed amount comes from the label rather than from the stored `amount`,
 * because a fixed discount capped by the balance records less than it was
 * configured for. Reading the cap back as the configuration would quietly hide
 * the capping behaviour from the replay.
 *
 * Every suffix is anchored to the end of the string, which matters more than it
 * looks: one real discount is *named* "Newsletter (first month only)" and applied
 * at overall scope, so anything looser than an anchored match reads it as a
 * first-month coupon and prices it against the wrong base.
 */
function parseDiscount(line: StoredLine, group: 'monthly' | 'overall'): Discount | null {
  if (group === 'monthly') {
    const percent = PERCENT.exec(line.name)
    if (percent) {
      return { kind: 'percentage', scope: 'monthly', label: line.name, percent: Number(percent[2]) }
    }

    const fixed = MONTHLY_FIXED.exec(line.name)
    if (fixed) {
      return { kind: 'fixed', scope: 'monthly', label: line.name, amount: fromNumeric(fixed[2]) }
    }

    return null
  }

  // Target-price coupons are read from `custom_discounts`, which keeps the target
  // itself; the label only states what the first month came down to.
  if (TARGET_PRICE.test(line.name)) return null

  const firstMonthPercent = FIRST_MONTH_PERCENT.exec(line.name)
  if (firstMonthPercent) {
    return {
      kind: 'percentage',
      scope: 'first_month',
      label: line.name,
      percent: Number(firstMonthPercent[2]),
    }
  }

  const firstMonthFixed = FIRST_MONTH_FIXED.exec(line.name)
  if (firstMonthFixed) {
    return {
      kind: 'fixed',
      scope: 'first_month',
      label: line.name,
      amount: fromNumeric(firstMonthFixed[2]),
    }
  }

  const percent = PERCENT.exec(line.name)
  if (percent) {
    return { kind: 'percentage', scope: 'overall', label: line.name, percent: Number(percent[2]) }
  }

  const fixed = OVERALL_FIXED.exec(line.name)
  if (fixed) {
    return { kind: 'fixed', scope: 'overall', label: line.name, amount: fromNumeric(fixed[2]) }
  }

  return null
}

function inputFor(row: SnapshotRow): SubscriptionInput {
  const discounts: Discount[] = []
  const unparsed: string[] = []

  for (const group of ['monthly', 'overall'] as const) {
    const lines =
      group === 'monthly' ? row.monthly_discount_breakdown : row.overall_discount_breakdown

    for (const line of lines ?? []) {
      const discount = parseDiscount(line, group)
      if (discount) discounts.push(discount)
      else if (!TARGET_PRICE.test(line.name)) unparsed.push(line.name)
    }
  }

  // A label this file cannot read back is a finding, not something to skip: it
  // means `labels.ts` and history have parted company.
  assert.deepEqual(unparsed, [], `unreadable discount labels on ${row.id}`)

  const target = (row.custom_discounts ?? []).find((d) => d.scope === 'target_price')
  const targetPrice: TargetPriceCoupon | null = target
    ? { name: target.name ?? '', targetPrice: fromNumeric(target.value) }
    : null

  // Reconstructed as flat charges: the snapshot records what each add-on came to,
  // never the rule that decided it. See the note at the top of the file.
  const addons: Addon[] = (row.addon_breakdown ?? []).map((line) => ({
    kind: 'flat',
    name: line.name,
    amount: fromNumeric(line.amount),
  }))

  const taxRate = Number(row.tax_rate ?? 0)

  // Passed back through because the column is a provider's sentence, not a
  // derived one, on the cream protocols that are dosed in pump clicks. Rows where
  // it is simply the milligrams still exercise the derivation, since the parsed
  // text and the derived text have to agree.
  const dosageLabel = /^\d+(\.\d+)?mg$/.test(row.dosage ?? '') ? null : row.dosage

  return {
    productName: row.product_name,
    monthlyPrice: fromNumeric(row.monthly_price),
    durationMonths: row.duration_months,
    dosageMg: Number(row.dosage_mg ?? 0),
    dosageLabel,
    isTaxable: taxRate > 0,
    taxRate,
    addons,
    discounts,
    targetPrice,
  }
}

/**
 * A stored ancillary line, read back as the selection that produced it.
 *
 * The pricing model is not recorded, so it is inferred from the shape of the
 * line: a quantity means per-capsule, a tier without one means tiered, no charge
 * at all means included, and anything else is a flat price. The inference is
 * checked by the assertion that follows it — a wrong guess produces a different
 * line — so this confirms the per-line arithmetic without claiming to confirm
 * which model the catalog holds.
 */
function selectionFor(line: Record<string, unknown>): AncillarySelection {
  const num = (key: string) => fromNumeric(line[key] as number | null)
  const tierLabel = (line.tier_label as string | null) ?? null
  const quantity = (line.quantity as number | null) ?? null
  const isTaxable = Boolean(line.is_taxable)
  const taxRate = Number(line.tax_rate ?? 0)

  const base = {
    name: String(line.name ?? ''),
    isTaxable,
    taxRate,
    quantity,
  }

  if (quantity !== null) {
    return {
      ...base,
      pricingModel: 'per_capsule',
      basePrice: 0 as Cents,
      processingFee: num('processing_fee'),
      tier: { label: tierLabel ?? '', price: num('unit_price'), defaultQuantity: null },
    }
  }

  if (tierLabel !== null) {
    return {
      ...base,
      pricingModel: 'tiered',
      basePrice: 0 as Cents,
      processingFee: 0 as Cents,
      tier: { label: tierLabel, price: num('unit_price'), defaultQuantity: null },
    }
  }

  const subtotal = num('subtotal')

  return {
    ...base,
    pricingModel: subtotal === 0 && num('unit_price') === 0 ? 'included' : 'flat',
    basePrice: num('unit_price'),
    processingFee: 0 as Cents,
    tier: null,
  }
}

/** Collects failures so one run reports every bad row, not just the first. */
function replay(check: (row: SnapshotRow, fail: (message: string) => void) => void) {
  const failures: string[] = []
  let checked = 0

  for (const row of fixture.rows) {
    checked++
    check(row, (message) => failures.push(`${row.id} (${row.tag}): ${message}`))
  }

  assert.ok(checked > 0, 'the fixture is empty — run scripts/dump-pricing-fixture.ts')

  if (failures.length) {
    assert.fail(`${failures.length} of ${checked} rows disagree:\n  ${failures.join('\n  ')}`)
  }
}

const subscriptionRows = fixture.rows.filter((row) => row.product_name !== ANCILLARY_ONLY)

test('the fixture holds both windows it is supposed to', () => {
  const recent = fixture.rows.filter((row) => row.tag === 'recent')
  const prepay = fixture.rows.filter((row) => row.duration_months > 1)

  assert.ok(recent.length > 100, `only ${recent.length} recent rows`)
  assert.ok(prepay.length > 20, `only ${prepay.length} prepay rows`)
  assert.ok(subscriptionRows.length > 100, `only ${subscriptionRows.length} subscription rows`)
})

test('every subscription chain reproduces to the cent', () => {
  replay((row, fail) => {
    if (row.product_name === ANCILLARY_ONLY) return

    const priced = priceSubscription(inputFor(row), new Date(row.created_at))

    const fields: [string, Cents, number | null][] = [
      ['price_before_discounts', priced.priceBeforeDiscounts, row.price_before_discounts],
      ['monthly_after_discounts', priced.monthlyAfterDiscounts, row.monthly_after_discounts],
      ['billing_period_total', priced.billingPeriodTotal, row.billing_period_total],
      [
        'subtotal_after_all_discounts',
        priced.subtotalAfterAllDiscounts,
        row.subtotal_after_all_discounts,
      ],
      ['tax_amount', priced.taxAmount, row.tax_amount],
      ['total_due_today', priced.totalDueToday, row.total_due_today],
      ['total_per_month', priced.totalPerMonth, row.total_per_month],
    ]

    for (const [name, ours, stored] of fields) {
      if (ours !== fromNumeric(stored)) {
        fail(`${name}: got ${toDollars(ours)}, stored ${stored}`)
      }
    }
  })
})

// Both the amounts and the exact label text, in the order they were recorded.
// The order is not incidental: it is what the patient sees, and it encodes which
// discount came off which balance.
test('every discount breakdown reproduces exactly, labels included', () => {
  replay((row, fail) => {
    if (row.product_name === ANCILLARY_ONLY) return

    const priced = priceSubscription(inputFor(row), new Date(row.created_at))

    const groups: [string, { name: string; amount: Cents }[], StoredLine[]][] = [
      [
        'monthly_discount_breakdown',
        priced.monthlyDiscountBreakdown,
        row.monthly_discount_breakdown ?? [],
      ],
      [
        'overall_discount_breakdown',
        priced.overallDiscountBreakdown,
        row.overall_discount_breakdown ?? [],
      ],
    ]

    for (const [group, ours, stored] of groups) {
      const got = ours.map((line) => [line.name, toDollars(line.amount)])
      const want = stored.map((line) => [line.name, toDollars(fromNumeric(line.amount))])

      if (JSON.stringify(got) !== JSON.stringify(want)) {
        fail(`${group}:\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
      }
    }
  })
})

test('the stored dosage and duration labels reproduce', () => {
  replay((row, fail) => {
    if (row.product_name === ANCILLARY_ONLY) return

    const priced = priceSubscription(inputFor(row), new Date(row.created_at))

    if (row.dosage !== null && priced.dosage !== row.dosage) {
      fail(`dosage: got ${priced.dosage}, stored ${row.dosage}`)
    }
    if (row.duration_label !== null && priced.durationLabel !== row.duration_label) {
      fail(`duration_label: got ${priced.durationLabel}, stored ${row.duration_label}`)
    }
  })
})

// The clock the legacy calculator read was a staff member's browser, so this also
// pins the clinic timezone the dates were computed in. See `labels.ts`.
test('the next billing date reproduces from the row’s own timestamp', () => {
  replay((row, fail) => {
    if (row.product_name === ANCILLARY_ONLY || !row.next_billing_date) return

    const priced = priceSubscription(inputFor(row), new Date(row.created_at))

    if (priced.nextBillingDate !== row.next_billing_date) {
      fail(`next_billing_date: got ${priced.nextBillingDate}, stored ${row.next_billing_date}`)
    }
  })
})

test('every ancillary line reproduces, in the shape it is stored in', () => {
  replay((row, fail) => {
    const stored = row.ancillary_line_items ?? []
    if (!stored.length) return

    const priced = priceAncillaries(stored.map(selectionFor))

    priced.lines.forEach((line, index) => {
      const got = ancillaryLineJson(line)
      const want = stored[index]

      for (const key of Object.keys(got)) {
        const ours = got[key]
        const theirs = want[key] ?? null

        // Numbers compare as numbers; the rest as they are stored.
        const same =
          typeof ours === 'number' && typeof theirs === 'number'
            ? fromNumeric(ours) === fromNumeric(theirs)
            : (ours ?? null) === theirs

        if (!same) {
          fail(`ancillary_line_items[${index}].${key}: got ${ours}, stored ${theirs}`)
        }
      }
    })
  })
})

test('the ancillary totals reproduce', () => {
  replay((row, fail) => {
    const stored = row.ancillary_line_items ?? []
    if (!stored.length) return

    const priced = priceAncillaries(stored.map(selectionFor))

    const fields: [string, Cents, number | null][] = [
      ['ancillary_subtotal', priced.subtotal, row.ancillary_subtotal],
      ['ancillary_tax_amount', priced.taxAmount, row.ancillary_tax_amount],
      ['ancillary_total', priced.total, row.ancillary_total],
    ]

    for (const [name, ours, storedValue] of fields) {
      if (ours !== fromNumeric(storedValue)) {
        fail(`${name}: got ${toDollars(ours)}, stored ${storedValue}`)
      }
    }
  })
})

// `grand_total` is nullable and one February row — a staff test, going by the
// add-on named "test add on" — never had it written. A missing figure is not a
// mismatch, so it is skipped rather than read as zero.
test('the grand total reproduces wherever it was recorded', () => {
  replay((row, fail) => {
    if (row.grand_total === null) return

    const subscription =
      row.product_name === ANCILLARY_ONLY
        ? null
        : priceSubscription(inputFor(row), new Date(row.created_at))

    const ancillaries = priceAncillaries((row.ancillary_line_items ?? []).map(selectionFor))

    const ours = fromNumeric(
      toDollars(subscription?.totalDueToday ?? (0 as Cents)) + toDollars(ancillaries.total)
    )

    if (ours !== fromNumeric(row.grand_total)) {
      fail(`grand_total: got ${toDollars(ours)}, stored ${row.grand_total}`)
    }
  })
})
