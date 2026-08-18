import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyDiscounts,
  discountTotal,
  fixedValueLabel,
  type AppliedDiscounts,
  type Discount,
} from './discounts.ts'
import { cents, fromNumeric, toDollars } from './money.ts'

const pct = (label: string, percent: number): Discount => ({
  kind: 'percentage',
  scope: 'monthly',
  label,
  percent,
})

const flat = (label: string, dollars: number): Discount => ({
  kind: 'fixed',
  scope: 'monthly',
  label,
  amount: fromNumeric(dollars),
})

/** Assertions read better in dollars, which is also how the snapshots record. */
const dollars = (result: AppliedDiscounts) => ({
  applied: result.applied.map((line) => toDollars(line.amount)),
  remaining: toDollars(result.remaining),
})

// The reason the order is worth a module. Both of these are a 20% discount and a
// $30 discount on a $129 protocol; they differ by six dollars a month.
test('percentages come off before fixed amounts', () => {
  const result = applyDiscounts(fromNumeric(129), [
    pct('Military/First Responder (20%)', 20),
    flat('Friends/Family (-$30.00/mo)', 30),
  ])

  assert.deepEqual(dollars(result), {
    applied: [25.8, 30],
    remaining: 73.2,
  })
})

test('the order holds even when the fixed discount is listed first', () => {
  const result = applyDiscounts(fromNumeric(129), [
    flat('Friends/Family (-$30.00/mo)', 30),
    pct('Military/First Responder (20%)', 20),
  ])

  // Percentage still first, and it reports in that order too, because the
  // breakdown is stored and shown to the patient.
  assert.deepEqual(dollars(result), {
    applied: [25.8, 30],
    remaining: 73.2,
  })
  assert.deepEqual(
    result.applied.map((line) => line.name),
    ['Military/First Responder (20%)', 'Friends/Family (-$30.00/mo)']
  )
})

// A real row: 20% then $30 off $129, recorded as 25.80 and 30.00 leaving 73.20.
test('each discount comes off what the last one left', () => {
  const result = applyDiscounts(fromNumeric(129), [pct('A (20%)', 20), pct('B (50%)', 50)])

  // 50% of the 103.20 remaining, not of the original 129.
  assert.deepEqual(dollars(result), { applied: [25.8, 51.6], remaining: 51.6 })
})

test('discounts keep the order they were given within a kind', () => {
  const result = applyDiscounts(fromNumeric(200), [
    pct('catalog first (10%)', 10),
    pct('custom second (10%)', 10),
    flat('catalog fixed', 5),
    flat('custom fixed', 5),
  ])

  assert.deepEqual(
    result.applied.map((line) => line.name),
    ['catalog first (10%)', 'custom second (10%)', 'catalog fixed', 'custom fixed']
  )
})

test('a fixed discount is capped at the balance', () => {
  const result = applyDiscounts(fromNumeric(30), [flat('Credit', 50)])

  assert.deepEqual(dollars(result), { applied: [30], remaining: 0 })
})

test('a balance is never taken below zero', () => {
  const result = applyDiscounts(fromNumeric(40), [flat('One', 30), flat('Two', 30)])

  assert.deepEqual(dollars(result), { applied: [30, 10], remaining: 0 })
})

test('nothing to apply leaves the balance alone', () => {
  const result = applyDiscounts(fromNumeric(129), [])

  assert.deepEqual(dollars(result), { applied: [], remaining: 129 })
})

// First-month discounts are deducted from the whole billing period total but
// sized against one month, so half off a six-month prepay is half of one month.
test('a first-month percentage is sized against one month, not the total', () => {
  const result = applyDiscounts(fromNumeric(619.2), [pct('Coupon (50%)', 50)], {
    percentBase: fromNumeric(103.2),
  })

  assert.deepEqual(dollars(result), { applied: [51.6], remaining: 567.6 })
})

// Existing behaviour, quirk included: because every percentage is sized against
// the same fixed base, two half-off coupons take a whole month rather than three
// quarters of one.
test('two first-month percentages do not compound', () => {
  const result = applyDiscounts(
    fromNumeric(619.2),
    [pct('One (50%)', 50), pct('Two (50%)', 50)],
    { percentBase: fromNumeric(103.2) }
  )

  assert.deepEqual(dollars(result), { applied: [51.6, 51.6], remaining: 516 })
})

// A fixed first-month discount still comes off the running total, not the month.
test('a fixed discount ignores the percentage base', () => {
  const result = applyDiscounts(fromNumeric(619.2), [flat('Coupon', 50)], {
    percentBase: fromNumeric(103.2),
  })

  assert.deepEqual(dollars(result), { applied: [50], remaining: 569.2 })
})

test('the total of a breakdown is the sum of its lines', () => {
  const result = applyDiscounts(fromNumeric(129), [pct('A (20%)', 20), flat('B', 30)])

  assert.equal(toDollars(discountTotal(result.applied)), 55.8)
  assert.equal(discountTotal([]), 0)
})

// The label carries the configured amount even where the balance capped what was
// actually taken, which is what the admin app has always shown.
test('a fixed value renders as a signed dollar amount', () => {
  assert.equal(fixedValueLabel(cents(3000)), '-$30.00')
  assert.equal(fixedValueLabel(cents(5)), '-$0.05')
})
