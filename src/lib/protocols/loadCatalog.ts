import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

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
