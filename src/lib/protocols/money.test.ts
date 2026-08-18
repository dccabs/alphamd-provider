import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addCents,
  cents,
  clampZero,
  divideCents,
  formatUsd,
  fromNumeric,
  minCents,
  pctOf,
  rateOf,
  subCents,
  timesCents,
  toDollars,
} from './money.ts'

/** The legacy chain's rounding helper, for asserting the two agree. */
const legacyRound = (value: number) => Math.round(value * 100) / 100

test('a numeric column becomes whole cents', () => {
  assert.equal(fromNumeric(129), 12900)
  assert.equal(fromNumeric(103.2), 10320)
  assert.equal(fromNumeric(56.66), 5666)
  assert.equal(fromNumeric('414.20'), 41420)
})

// 103.2 * 100 is 10320.000000000002 in binary floating point, and 56.66 * 100 is
// 5665.999999999999. Both are real values from the snapshot fixture, so the
// conversion has to round rather than truncate.
test('float dollar amounts convert without drifting a cent', () => {
  for (const dollars of [103.2, 56.66, 73.52, 441.12, 26.92, 0.065 * 53.2]) {
    assert.equal(fromNumeric(dollars), Math.round(dollars * 100), `wrong for ${dollars}`)
  }
})

test('a missing figure reads as zero rather than throwing', () => {
  // `grand_total` is nullable and at least one real row leaves it unset.
  assert.equal(fromNumeric(null), 0)
  assert.equal(fromNumeric(undefined), 0)
  assert.equal(fromNumeric(''), 0)
  assert.equal(fromNumeric('not a number'), 0)
  assert.equal(fromNumeric(Number.NaN), 0)
  assert.equal(fromNumeric(Number.POSITIVE_INFINITY), 0)
})

test('cents round-trip to dollars', () => {
  assert.equal(toDollars(cents(5666)), 56.66)
  assert.equal(toDollars(cents(0)), 0)
  assert.equal(toDollars(fromNumeric(441.12)), 441.12)
})

test('arithmetic keeps whole cents', () => {
  assert.equal(addCents(cents(100), cents(250), cents(1)), 351)
  assert.equal(addCents(), 0)
  assert.equal(subCents(cents(10320), cents(2580)), 7740)
  assert.equal(minCents(cents(5000), cents(7320)), 5000)
})

test('a balance is never negative', () => {
  assert.equal(clampZero(subCents(cents(1000), cents(2500))), 0)
  assert.equal(clampZero(cents(250)), 250)
})

test('a percentage matches what the legacy chain computed', () => {
  // The real row: 20% off $129 was recorded as 25.80.
  assert.equal(pctOf(fromNumeric(129), 20), 2580)
  assert.equal(toDollars(pctOf(fromNumeric(129), 20)), 25.8)

  // And 50% of the $103.20 left after it, recorded as 51.60.
  assert.equal(toDollars(pctOf(fromNumeric(103.2), 50)), 51.6)
})

// The rule is half *up*, not half to even, because that is what `Math.round`
// does and therefore what every stored snapshot was computed with.
test('a percentage landing on half a cent rounds up', () => {
  // 10% of $1.05 is 10.5 cents.
  assert.equal(pctOf(fromNumeric(1.05), 10), 11)
  // 50% of 3 cents is 1.5.
  assert.equal(pctOf(cents(3), 50), 2)
})

// The guarantee the whole rewrite rests on: for any amount up to $600 and any
// percentage the clinic uses, this produces exactly what the admin app produces.
// Unconditional, not "no counterexample turned up in the fixture" — the old app
// keeps pricing protocols alongside this one, and two systems quoting the same
// protocol a cent apart would be worse than the odd-looking float arithmetic
// inside `pctOf`.
test('a percentage matches the legacy formula across the whole domain', () => {
  for (let c = 1; c <= 60_000; c++) {
    for (const percent of [5, 10, 12.5, 15, 20, 25, 33, 50, 100]) {
      const ours = toDollars(pctOf(cents(c), percent))
      const legacy = legacyRound((c / 100) * (percent / 100))
      if (ours !== legacy) {
        assert.fail(`${percent}% of ${c / 100}: got ${ours}, legacy gives ${legacy}`)
      }
    }
  }
})

// The cases that made mirroring legacy worth the trouble. Exact decimal
// arithmetic puts both of these on a half cent and would round them up; legacy's
// binary product lands just under the half and rounds down. Neither base is
// exotic — 29 cents and $13.70 are both whole numbers of cents.
test('halves that fall just short of the boundary round down, as legacy does', () => {
  assert.equal(toDollars(pctOf(fromNumeric(0.29), 50)), 0.14)
  assert.equal(toDollars(pctOf(fromNumeric(13.7), 15)), 2.05)
})

// And the boundary case that does occur in real data — 12.5% off $129 — lands on
// an exact half that both rules round up, because 0.125 is a power of two.
test('an exactly representable half rounds up', () => {
  assert.equal(toDollars(pctOf(fromNumeric(129), 12.5)), 16.13)
})

test('tax matches the legacy formula across the whole domain', () => {
  for (let c = 1; c <= 60_000; c++) {
    for (const rate of [0, 0.04, 0.065, 0.0825, 0.1]) {
      const ours = toDollars(rateOf(cents(c), rate))
      const legacy = legacyRound((c / 100) * rate)
      if (ours !== legacy) {
        assert.fail(`${rate} of ${c / 100}: got ${ours}, legacy gives ${legacy}`)
      }
    }
  }
})

test('a rate is a fraction, not a percentage', () => {
  // The real row: 6.5% tax on $53.20 was recorded as 3.46 (from 3.458).
  assert.equal(toDollars(rateOf(fromNumeric(53.2), 0.065)), 3.46)
  // And on $414.20, recorded as 26.92 (from 26.923).
  assert.equal(toDollars(rateOf(fromNumeric(414.2), 0.065)), 26.92)
  assert.equal(rateOf(cents(10000), 0), 0)
})

test('a non-finite rate or percentage takes nothing off', () => {
  assert.equal(pctOf(cents(10000), Number.NaN), 0)
  assert.equal(rateOf(cents(10000), Number.NaN), 0)
})

test('the billing period total is the monthly figure times the months', () => {
  // The real row: $73.20 over 6 months was recorded as 439.20.
  assert.equal(toDollars(timesCents(fromNumeric(73.2), 6)), 439.2)
  assert.equal(toDollars(timesCents(fromNumeric(103.2), 1)), 103.2)
})

test('the per-month figure is the total split evenly', () => {
  // The real row: $441.12 over 6 months was recorded as 73.52.
  assert.equal(toDollars(divideCents(fromNumeric(441.12), 6)), 73.52)
  // A zero or nonsense duration leaves the figure alone, as legacy does.
  assert.equal(divideCents(cents(5666), 0), 5666)
  assert.equal(divideCents(cents(5666), Number.NaN), 5666)
})

// No thousands separator, because these strings end up inside discount labels
// that are stored in pricing_snapshots and rendered by the patient pages, and
// the legacy code builds them with toFixed(2).
test('money formats without a thousands separator', () => {
  assert.equal(formatUsd(cents(5000)), '$50.00')
  assert.equal(formatUsd(cents(3)), '$0.03')
  assert.equal(formatUsd(cents(123456)), '$1234.56')
  assert.equal(formatUsd(cents(0)), '$0.00')
})
