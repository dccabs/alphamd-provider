import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addonLabel,
  dosageLabel,
  durationLabel,
  firstMonthFixedLabel,
  firstMonthPercentageLabel,
  monthlyFixedLabel,
  monthlyPercentageLabel,
  nextBillingDateLabel,
  overallFixedLabel,
  overallPercentageLabel,
  targetPriceLabel,
} from './labels.ts'
import { fromNumeric } from './money.ts'

// Every expected string below is copied out of a real `pricing_snapshots` row
// rather than retyped, because these are stored on the record and rendered by
// alphamd's patient pages.

test('a monthly percentage reads as the admin app writes it', () => {
  assert.equal(
    monthlyPercentageLabel('Military/First Responder', 20),
    'Military/First Responder (20%)'
  )
})

test('a fractional percentage keeps its decimal', () => {
  assert.equal(monthlyPercentageLabel('Loyalty', 12.5), 'Loyalty (12.5%)')
})

test('a monthly fixed discount carries the rate', () => {
  assert.equal(monthlyFixedLabel('Friends/Family', fromNumeric(30)), 'Friends/Family (-$30.00/mo)')
})

// The en dash is the detail worth a test of its own: it is U+2013, not a hyphen,
// and the difference is invisible in review but shows up as a parity failure.
test('the first-month suffix uses an en dash', () => {
  const label = firstMonthPercentageLabel('Coupon: 4THOFJULY26', 50)

  assert.equal(label, 'Coupon: 4THOFJULY26 (50% – first month only)')
  assert.ok(label.includes('\u2013'), 'expected an en dash')
  assert.ok(!label.includes(' - '), 'expected no hyphen')
})

test('a fixed first-month coupon reads as the admin app writes it', () => {
  assert.equal(
    firstMonthFixedLabel('Coupon: SWITCH2026', fromNumeric(50)),
    'Coupon: SWITCH2026 (-$50.00 – first month only)'
  )
})

test('an overall fixed discount has no rate suffix', () => {
  assert.equal(overallFixedLabel('overall', fromNumeric(25)), 'overall (-$25.00)')
  assert.equal(overallPercentageLabel('Spring promo', 10), 'Spring promo (10%)')
})

// Four-figure discounts are where a thousands separator would creep in. The
// legacy code builds these with toFixed(2), so there is none.
test('a large amount carries no thousands separator', () => {
  assert.equal(overallFixedLabel('Prepay credit', fromNumeric(1200)), 'Prepay credit (-$1200.00)')
})

test('an unnamed custom entry falls back to the admin app’s wording', () => {
  assert.equal(monthlyPercentageLabel(null, 10), 'Custom Discount (10%)')
  assert.equal(monthlyPercentageLabel('   ', 10), 'Custom Discount (10%)')
  assert.equal(overallFixedLabel(undefined, fromNumeric(5)), 'Custom Discount (-$5.00)')
  assert.equal(firstMonthPercentageLabel(null, 50), 'Coupon Discount (50% – first month only)')
  assert.equal(addonLabel(null), 'Custom Add-on')
  assert.equal(addonLabel('Extra vial'), 'Extra vial')
})

// The coupon code is stored on the name as "Coupon: WELCOME50", and the label
// would otherwise print the prefix twice.
test('a target-price coupon states the price it landed on', () => {
  assert.equal(
    targetPriceLabel('Coupon: WELCOME50', fromNumeric(99)),
    'Coupon applied (WELCOME50): first month reduced to $99.00'
  )
})

test('a target-price coupon without a code still reads sensibly', () => {
  assert.equal(
    targetPriceLabel(null, fromNumeric(99)),
    'Coupon applied: first month reduced to $99.00'
  )
})

test('durations read the way they are stored', () => {
  assert.equal(durationLabel(1), 'Monthly')
  assert.equal(durationLabel(3), '3 Months')
  assert.equal(durationLabel(6), '6 Months')
  assert.equal(durationLabel(12), '12 Months')
  // Any prepay plan nobody has named yet.
  assert.equal(durationLabel(4), '4 Months')
})

test('a dose with no subscription reads N/A', () => {
  assert.equal(dosageLabel(100), '100mg')
  assert.equal(dosageLabel(0), 'N/A')
})

// A real row: created 2026-08-17T13:55Z on a monthly plan, stored as
// "September 17, 2026".
test('the next billing date is a month out for a monthly plan', () => {
  assert.equal(
    nextBillingDateLabel(new Date('2026-08-17T13:55:41Z'), 1),
    'September 17, 2026'
  )
})

// The row that identified the clinic's timezone: written at 05:30 UTC, which is
// half past ten the previous evening in California, and billed a month from that
// previous day.
test('the date follows the clinic’s calendar, not the server’s', () => {
  assert.equal(nextBillingDateLabel(new Date('2026-07-29T05:30:15Z'), 1), 'August 28, 2026')
})

test('a prepay plan is billed at the end of its term', () => {
  assert.equal(nextBillingDateLabel(new Date('2026-02-10T18:00:00Z'), 6), 'August 10, 2026')
  assert.equal(nextBillingDateLabel(new Date('2026-03-26T18:00:00Z'), 12), 'March 26, 2027')
})

// Preserved from the legacy `setMonth`, which overflows rather than clamping. No
// snapshot lands on such a day, so this test is the only thing recording the
// decision.
test('a month with too few days rolls over rather than clamping', () => {
  assert.equal(nextBillingDateLabel(new Date('2026-01-31T18:00:00Z'), 1), 'March 3, 2026')
  assert.equal(nextBillingDateLabel(new Date('2026-08-31T18:00:00Z'), 6), 'March 3, 2027')
})
