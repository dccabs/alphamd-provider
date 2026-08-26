import assert from 'node:assert/strict'
import test from 'node:test'

import type { AssignedCoupon } from '../protocols/assignedCoupon.ts'
import { EMPTY_DRAFT } from './reviewDraft.ts'
import {
  NEWSLETTER_DISCOUNT_ID,
  expiredAssignedCoupon,
  seedDiscounts,
} from './discountSeed.ts'

const NOW = new Date('2026-08-26T12:00:00Z')

const live: AssignedCoupon = {
  code: 'SWITCH2026',
  expiresAt: '2026-12-31',
  discountType: 'fixed',
  discountValue: 50,
  discountScope: 'first_month',
  targetPrice1mo: null,
}

const expired: AssignedCoupon = {
  ...live,
  code: 'OLDCODE',
  expiresAt: '2026-01-01',
}

test('newsletter and a live coupon are written once', () => {
  const seeded = seedDiscounts(
    EMPTY_DRAFT,
    { inNewsletter: true, coupon: live },
    NOW
  )

  assert.deepEqual(seeded.selectedDiscountIds, [NEWSLETTER_DISCOUNT_ID])
  assert.equal(seeded.couponCode, 'SWITCH2026')
  assert.equal(seeded.discountsSeeded, true)
})

test('a second seed does not put back a cleared selection', () => {
  const cleared = {
    ...EMPTY_DRAFT,
    selectedDiscountIds: [],
    couponCode: null,
    discountsSeeded: true,
  }

  const again = seedDiscounts(cleared, { inNewsletter: true, coupon: live }, NOW)
  assert.deepEqual(again.selectedDiscountIds, [])
  assert.equal(again.couponCode, null)
})

test('an expired coupon is not seeded', () => {
  const seeded = seedDiscounts(
    EMPTY_DRAFT,
    { inNewsletter: false, coupon: expired },
    NOW
  )

  assert.equal(seeded.couponCode, null)
  assert.equal(seeded.discountsSeeded, true)
  assert.equal(expiredAssignedCoupon(expired, NOW)?.code, 'OLDCODE')
  assert.equal(expiredAssignedCoupon(live, NOW), null)
})

test('no newsletter and no coupon still marks the draft seeded', () => {
  const seeded = seedDiscounts(EMPTY_DRAFT, { inNewsletter: false, coupon: null }, NOW)
  assert.deepEqual(seeded.selectedDiscountIds, [])
  assert.equal(seeded.couponCode, null)
  assert.equal(seeded.discountsSeeded, true)
})
