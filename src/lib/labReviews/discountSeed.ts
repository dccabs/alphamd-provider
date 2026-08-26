// Explicit `.ts` specifiers: this module is exercised by `npm test`.
import {
  hasMedicationPricing,
  isLiveCoupon,
  type AssignedCoupon,
} from '../protocols/assignedCoupon.ts'
import type { ReviewDraft } from './reviewDraft.ts'

/**
 * The Catalog Discount id the patient-facing pages already hardcode for
 * Newsletter. Matched by id, not by name.
 */
export const NEWSLETTER_DISCOUNT_ID = 6

export type DiscountEligibility = {
  inNewsletter: boolean
  coupon: AssignedCoupon | null
}

/**
 * Write Newsletter and the assigned live Coupon onto a draft once.
 *
 * After this, the draft is the source of truth: uncheck or skip is not put
 * back the next time the flyout opens. An expired assigned Coupon is left off
 * — the Provider can still check it on.
 */
export function seedDiscounts(
  draft: ReviewDraft,
  eligibility: DiscountEligibility,
  now: Date = new Date()
): ReviewDraft {
  if (draft.discountsSeeded) return draft

  const selectedDiscountIds = eligibility.inNewsletter
    ? [NEWSLETTER_DISCOUNT_ID]
    : []

  const coupon =
    eligibility.coupon && isLiveCoupon(eligibility.coupon, now) ? eligibility.coupon : null

  return {
    ...draft,
    selectedDiscountIds,
    couponCode: coupon?.code ?? null,
    discountsSeeded: true,
  }
}

/** True when the assigned Coupon is on file but we will not seed it. */
export function draftPricing(draft: ReviewDraft): {
  selectedDiscountIds: number[]
  couponCode: string | null
} {
  return {
    selectedDiscountIds: draft.selectedDiscountIds,
    couponCode: draft.couponCode,
  }
}

export function expiredAssignedCoupon(
  coupon: AssignedCoupon | null,
  now: Date = new Date()
): AssignedCoupon | null {
  if (!coupon || !hasMedicationPricing(coupon)) return null
  return isLiveCoupon(coupon, now) ? null : coupon
}