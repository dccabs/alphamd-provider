import assert from 'node:assert/strict'
import test from 'node:test'

import {
  couponAsCustomDiscount,
  couponToPricing,
  isCouponExpired,
  isLiveCoupon,
  pickCouponRow,
  type AssignedCoupon,
  type CouponRow,
} from './assignedCoupon.ts'
import { fromNumeric } from './money.ts'

const NOW = new Date('2026-08-26T12:00:00Z')

const target: AssignedCoupon = {
  code: 'WELCOME50',
  expiresAt: null,
  discountType: null,
  discountValue: null,
  discountScope: null,
  targetPrice1mo: 99,
}

const percent: AssignedCoupon = {
  code: 'HALF',
  expiresAt: '2026-12-31',
  discountType: 'percentage',
  discountValue: 50,
  discountScope: 'first_month',
  targetPrice1mo: null,
}

test('a target-price coupon becomes a first-month target, not a discount', () => {
  const pricing = couponToPricing(target)
  assert.deepEqual(pricing.targetPrice, {
    name: 'Coupon: WELCOME50',
    targetPrice: fromNumeric(99),
  })
  assert.deepEqual(pricing.discounts, [])
  assert.deepEqual(couponAsCustomDiscount(target), {
    name: 'Coupon: WELCOME50',
    type: 'fixed',
    scope: 'target_price',
    value: 99,
  })
})

test('a first-month percentage coupon is a discount with the coupon label', () => {
  const { targetPrice, discounts } = couponToPricing(percent)
  assert.equal(targetPrice, null)
  assert.equal(discounts.length, 1)
  assert.equal(discounts[0]?.kind, 'percentage')
  assert.equal(discounts[0]?.scope, 'first_month')
  assert.match(discounts[0]?.label ?? '', /Coupon: HALF/)
})

test('when two coupons only differ by case, the assigned spelling wins', () => {
  const alphaSummer: CouponRow = {
    code: 'AlphaSummer',
    expiration_date: '2028-06-08T05:00:00.000Z',
    medication_discount_type: null,
    medication_discount_value: null,
    medication_discount_scope: 'first_month',
    medication_target_price_1mo: null,
  }
  const upper: CouponRow = {
    ...alphaSummer,
    code: 'ALPHASUMMER',
    expiration_date: '2029-11-08T06:00:00.000Z',
  }

  assert.equal(pickCouponRow([alphaSummer, upper], 'ALPHASUMMER')?.code, 'ALPHASUMMER')
  assert.equal(pickCouponRow([alphaSummer, upper], 'AlphaSummer')?.code, 'AlphaSummer')
  assert.equal(pickCouponRow([alphaSummer, upper], 'alphasummer')?.code, 'AlphaSummer')
  assert.equal(pickCouponRow([], 'ALPHASUMMER'), null)
})

test('a date-only expiration stays live through the end of that day', () => {
  const sameDay: AssignedCoupon = { ...percent, expiresAt: '2026-08-26' }
  assert.equal(isCouponExpired(sameDay, NOW), false)
  assert.equal(isLiveCoupon(sameDay, NOW), true)

  const yesterday: AssignedCoupon = { ...percent, expiresAt: '2026-08-25' }
  assert.equal(isCouponExpired(yesterday, NOW), true)
  assert.equal(isLiveCoupon(yesterday, NOW), false)
})
