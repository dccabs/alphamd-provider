// Explicit `.ts` specifiers: this module is exercised by `npm test`.
import type { Discount } from './discounts.ts'
import {
  firstMonthFixedLabel,
  firstMonthPercentageLabel,
  monthlyFixedLabel,
  monthlyPercentageLabel,
  overallFixedLabel,
  overallPercentageLabel,
} from './labels.ts'
import { fromNumeric, type Cents } from './money.ts'
import type { TargetPriceCoupon } from './price.ts'

/**
 * The Coupon already on a Patient — `user_list.coupon_code` resolved against
 * `coupon_code`.
 *
 * A different thing from a Catalog Discount. It can set a first-month or target
 * price. This portal only auto-applies the assigned, unexpired one; the Provider
 * can take it off or check an expired one on.
 */

export type AssignedCoupon = {
  code: string
  expiresAt: string | null
  discountType: 'percentage' | 'fixed' | null
  discountValue: number | null
  discountScope: 'first_month' | 'monthly' | 'overall' | null
  targetPrice1mo: number | null
}

export type CouponRow = {
  code: string
  expiration_date: string | null
  medication_discount_type: string | null
  medication_discount_value: number | null
  medication_discount_scope: string | null
  medication_target_price_1mo: number | null
}

export function parseAssignedCoupon(row: CouponRow): AssignedCoupon {
  const type = row.medication_discount_type
  const scope = row.medication_discount_scope

  return {
    code: row.code.trim(),
    expiresAt: row.expiration_date,
    discountType: type === 'percentage' || type === 'fixed' ? type : null,
    discountValue:
      typeof row.medication_discount_value === 'number' ? row.medication_discount_value : null,
    discountScope:
      scope === 'monthly' || scope === 'overall' || scope === 'first_month'
        ? scope
        : scope === 'six_month_commitment'
          ? 'first_month'
          : null,
    targetPrice1mo:
      typeof row.medication_target_price_1mo === 'number' ? row.medication_target_price_1mo : null,
  }
}

export function hasMedicationPricing(coupon: AssignedCoupon): boolean {
  return (
    (coupon.discountType !== null && coupon.discountValue !== null) || coupon.targetPrice1mo !== null
  )
}

export function isCouponExpired(coupon: AssignedCoupon, now: Date = new Date()): boolean {
  if (!coupon.expiresAt) return false

  if (!coupon.expiresAt.includes('T')) {
    const [year, month, day] = coupon.expiresAt.split('-').map(Number)
    if (!year || !month || !day) return false
    return Date.UTC(year, month - 1, day, 23, 59, 59, 999) < now.getTime()
  }

  const expiresAt = new Date(coupon.expiresAt)
  if (Number.isNaN(expiresAt.getTime())) return false
  return expiresAt < now
}

/** Has medication pricing and has not expired — the one we seed onto a draft. */
export function isLiveCoupon(coupon: AssignedCoupon, now: Date = new Date()): boolean {
  return hasMedicationPricing(coupon) && !isCouponExpired(coupon, now)
}

export function couponToPricing(coupon: AssignedCoupon): {
  targetPrice: TargetPriceCoupon | null
  discounts: Discount[]
} {
  if (coupon.targetPrice1mo != null) {
    return {
      targetPrice: {
        name: `Coupon: ${coupon.code}`,
        targetPrice: fromNumeric(coupon.targetPrice1mo),
      },
      discounts: [],
    }
  }

  if (coupon.discountType === null || coupon.discountValue === null) {
    return { targetPrice: null, discounts: [] }
  }

  const scope = coupon.discountScope ?? 'first_month'
  const name = `Coupon: ${coupon.code}`

  if (coupon.discountType === 'percentage') {
    const percent = coupon.discountValue
    const label =
      scope === 'monthly'
        ? monthlyPercentageLabel(name, percent)
        : scope === 'overall'
          ? overallPercentageLabel(name, percent)
          : firstMonthPercentageLabel(name, percent)
    return {
      targetPrice: null,
      discounts: [{ kind: 'percentage', scope, label, percent }],
    }
  }

  const amount = fromNumeric(coupon.discountValue) as Cents
  const label =
    scope === 'monthly'
      ? monthlyFixedLabel(name, amount)
      : scope === 'overall'
        ? overallFixedLabel(name, amount)
        : firstMonthFixedLabel(name, amount)
  return {
    targetPrice: null,
    discounts: [{ kind: 'fixed', scope, label, amount }],
  }
}

/** The shape `pricing_snapshots.custom_discounts` stores for a Coupon. */
export function couponAsCustomDiscount(coupon: AssignedCoupon): {
  name: string
  type: 'percentage' | 'fixed'
  scope: 'monthly' | 'first_month' | 'overall' | 'target_price'
  value: number
} | null {
  if (coupon.targetPrice1mo != null) {
    return {
      name: `Coupon: ${coupon.code}`,
      type: 'fixed',
      scope: 'target_price',
      value: coupon.targetPrice1mo,
    }
  }

  if (coupon.discountType === null || coupon.discountValue === null) return null

  return {
    name: `Coupon: ${coupon.code}`,
    type: coupon.discountType,
    scope: coupon.discountScope ?? 'first_month',
    value: coupon.discountValue,
  }
}