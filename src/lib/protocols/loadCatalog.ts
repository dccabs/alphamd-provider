import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

import { parseAssignedCoupon, type AssignedCoupon, type CouponRow } from './assignedCoupon'
import {
  ANCILLARY_SELECT,
  DISCOUNT_SELECT,
  SUBSCRIPTION_SELECT,
  parseAncillaryProduct,
  parseCatalogDiscount,
  parseSubscriptionProduct,
  type AncillaryRow,
  type DiscountRow,
  type PricingCatalog,
  type SubscriptionRow,
} from './catalog'

/**
 * Reading the pricing catalog out of the six tables that describe it.
 *
 * **Server-only.** It holds the service-role client, and the `server-only` import
 * above turns reaching for this from a client component into a build error. That
 * is also why it is this thin: everything with a decision in it — the shapes, the
 * parsing, the lookups — is in `catalog.ts`, on the side of the line that unit
 * tests and scripts can reach. What is left here is three round trips and the
 * error message you get when one fails.
 *
 * Three queries rather than six, since PostgREST will nest the plans, add-ons and
 * tiers under their parents.
 *
 * Withdrawn products are read rather than filtered out. A provider who adds a
 * medication the clinic has stopped selling should be told exactly that, and
 * telling them needs the row — see `resolveMedication`, which distinguishes
 * `withdrawn` from `not-in-catalog`.
 */
export async function loadPricingCatalog(): Promise<PricingCatalog> {
  const supabase = createAdminClient()

  const [subscriptions, ancillaries, discounts] = await Promise.all([
    supabase.from('subscription_products').select(SUBSCRIPTION_SELECT).returns<SubscriptionRow[]>(),
    supabase.from('ancillary_products').select(ANCILLARY_SELECT).returns<AncillaryRow[]>(),
    supabase.from('subscription_discounts').select(DISCOUNT_SELECT).returns<DiscountRow[]>(),
  ])

  for (const [what, result] of [
    ['subscription products', subscriptions],
    ['ancillary products', ancillaries],
    ['discounts', discounts],
  ] as const) {
    if (result.error) {
      throw new Error(`Could not read the pricing catalog (${what}): ${result.error.message}`)
    }
  }

  return {
    subscriptions: (subscriptions.data ?? []).map(parseSubscriptionProduct),
    ancillaries: (ancillaries.data ?? []).map(parseAncillaryProduct),
    discounts: (discounts.data ?? []).map(parseCatalogDiscount),
  }
}

export async function loadCouponByCode(code: string | null): Promise<AssignedCoupon | null> {
  const trimmed = code?.trim()
  if (!trimmed) return null

  const { data, error } = await createAdminClient()
    .from('coupon_code')
    .select(
      'code, expiration_date, medication_discount_type, medication_discount_value, medication_discount_scope, medication_target_price_1mo'
    )
    .ilike('code', trimmed)
    .maybeSingle()

  if (error) throw new Error(`Could not read coupon ${trimmed}: ${error.message}`)
  if (!data) return null

  return parseAssignedCoupon(data as CouponRow)
}

export async function listSubscriptionMedicationIds(): Promise<number[]> {
  const { data, error } = await createAdminClient()
    .from('subscription_products')
    .select('medication_id')
    .eq('is_active', true)

  if (error) {
    throw new Error(`Could not read subscription products: ${error.message}`)
  }

  return (data ?? [])
    .map((row) => row.medication_id as number | null)
    .filter((id): id is number => typeof id === 'number' && id > 0)
}
