import {
  addonsFor,
  discountsFor,
  planFor,
  type AncillaryProduct,
  type AncillaryTier,
  type PricingCatalog,
  type SubscriptionProduct,
} from './catalog.ts'
import type { Discount } from './discounts.ts'
import type { AncillarySelection, SubscriptionInput, TargetPriceCoupon } from './price.ts'

/**
 * Turning a medication a provider chose into something that can be priced.
 *
 * A lab review records a medication id and a dose. The catalog is organised
 * around products, which is nearly but not quite the same thing, and the gap is
 * where this module lives. Three answers are possible and all three are normal:
 *
 *   - a subscription product, which is a recurring plan with a term;
 *   - an ancillary product, which is a one-off charge alongside a subscription;
 *   - nothing, because the clinic prescribes plenty that it does not price here.
 *
 * The third case is not an error and must not be treated as one. It is the most
 * common single outcome — "Other" alone accounts for well over a hundred of the
 * medications added in a month — and the right response is to hand the protocol to
 * staff rather than to guess a price. A wrong price on a card is worse than no
 * price at all.
 *
 * Pure, so the verdict can be shown to a provider while they work rather than
 * discovered when the review is submitted.
 */

/** Why a medication could not be priced automatically. */
export type UnpriceableReason =
  /** No product in the catalog is linked to this medication. */
  | 'not-in-catalog'
  /** Linked to a product that has been withdrawn. */
  | 'withdrawn'
  /** More than one active product matches, and only a human can choose. */
  | 'ambiguous'
  /** A subscription product with no plan for the term being quoted. */
  | 'no-plan-for-term'
  /** An ancillary priced by tier, with no tier chosen. */
  | 'tier-required'

export type Resolution =
  | { kind: 'subscription'; product: SubscriptionProduct }
  | { kind: 'ancillary'; product: AncillaryProduct }
  | { kind: 'unpriceable'; reason: UnpriceableReason; candidates: string[] }

/**
 * Which product prices a medication.
 *
 * Subscriptions are checked first. It matters for enclomiphene, which exists as
 * both a subscription (`medication_id` 29) and two ancillaries (33 and 34) — but
 * under different medication ids, so the precedence is belt and braces rather
 * than load-bearing. If a medication is ever linked to both, the recurring plan
 * is the one a provider means by adding it to a protocol.
 *
 * Two active products for one medication is a real state, not a theoretical one:
 * Sermorelin is stocked as "Sermorelin (California)" at $264.99 and "Sermorelin
 * (non California)" at $229.99, both linked to medication 31, because the price
 * depends on where the patient lives. There is nothing in a lab review that
 * decides between them, so this returns `ambiguous` with both names and lets a
 * human pick.
 *
 * A medication linked only to *withdrawn* products reports `withdrawn` rather
 * than `not-in-catalog`, because the two want different words in front of a
 * provider: one is "we do not price this here", the other is "we stopped selling
 * this". Anavar and Nandrolone are both in that state.
 */
export function resolveMedication(catalog: PricingCatalog, medicationId: number): Resolution {
  const subscriptions = catalog.subscriptions.filter(
    (product) => product.medicationId === medicationId
  )
  const ancillaries = catalog.ancillaries.filter((product) => product.medicationId === medicationId)

  const activeSubscriptions = subscriptions.filter((product) => product.isActive)
  const activeAncillaries = ancillaries.filter((product) => product.isActive)
  const active = [...activeSubscriptions, ...activeAncillaries]

  if (active.length > 1) {
    return { kind: 'unpriceable', reason: 'ambiguous', candidates: active.map((p) => p.name) }
  }

  if (activeSubscriptions.length === 1) {
    return { kind: 'subscription', product: activeSubscriptions[0] }
  }

  if (activeAncillaries.length === 1) {
    return { kind: 'ancillary', product: activeAncillaries[0] }
  }

  const withdrawn = [...subscriptions, ...ancillaries]
  if (withdrawn.length > 0) {
    return {
      kind: 'unpriceable',
      reason: 'withdrawn',
      candidates: withdrawn.map((product) => product.name),
    }
  }

  return { kind: 'unpriceable', reason: 'not-in-catalog', candidates: [] }
}

export type SubscriptionRequest = {
  product: SubscriptionProduct
  durationMonths: number
  dosageMg: number
  /** What the patient is told to do, when that is not a number of milligrams. */
  dosageLabel?: string | null
  selectedDiscountIds?: number[]
  selectedAddonIds?: number[]
  targetPrice?: TargetPriceCoupon | null
  extraDiscounts?: Discount[]
}

/**
 * A resolved subscription, ready for `priceSubscription`.
 *
 * The monthly price comes from the *plan*, not from the product's
 * `base_monthly_price`: a twelve-month term on the cypionate is $98 a month
 * against a $129 list price, and reading the product would quietly charge the
 * list price for a prepay plan. The product's own price is a default for a
 * product with no plans, which nothing in the catalog currently is.
 */
export function subscriptionInput(
  catalog: PricingCatalog,
  request: SubscriptionRequest,
  now: Date = new Date()
): SubscriptionInput | { unpriceable: UnpriceableReason } {
  const plan = planFor(request.product, request.durationMonths)
  if (!plan) return { unpriceable: 'no-plan-for-term' }

  return {
    productName: request.product.name,
    monthlyPrice: plan.monthlyPrice,
    durationMonths: plan.durationMonths,
    dosageMg: request.dosageMg,
    dosageLabel: request.dosageLabel ?? null,
    isTaxable: request.product.isTaxable,
    taxRate: request.product.taxRate,
    addons: addonsFor(request.product, request.selectedAddonIds ?? []),
    discounts: [
      ...discountsFor(catalog, request.product, request.selectedDiscountIds ?? [], now),
      ...(request.extraDiscounts ?? []),
    ],
    targetPrice: request.targetPrice ?? null,
  }
}

/** The tiers a patient may be quoted, cheapest first by the catalog's own order. */
export function activeTiers(product: AncillaryProduct): AncillaryTier[] {
  return product.tiers
    .filter((tier) => tier.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
}

/** Whether a choice of tier is needed before this can be priced. */
export function needsTier(product: AncillaryProduct): boolean {
  return product.pricingModel === 'per_capsule' || product.pricingModel === 'tiered'
}

/**
 * A resolved ancillary, ready for `priceAncillaries`.
 *
 * Refuses to price a tiered item without a tier. The engine would happily return
 * a $0.00 line for one — that is the legacy behaviour and it is preserved there —
 * but a quote that silently gives away Enclomiphene is worth catching here, where
 * the answer can still be "ask the provider which strength".
 */
export function ancillarySelection(
  product: AncillaryProduct,
  options: { tierId?: number | null; quantity?: number | null } = {}
): AncillarySelection | { unpriceable: UnpriceableReason } {
  const tiers = activeTiers(product)

  const tier =
    options.tierId != null
      ? (tiers.find((candidate) => candidate.id === options.tierId) ?? null)
      : tiers.length === 1
        ? tiers[0]
        : null

  if (needsTier(product) && !tier) return { unpriceable: 'tier-required' }

  return {
    name: product.name,
    pricingModel: product.pricingModel,
    basePrice: product.basePrice,
    processingFee: product.processingFee,
    isTaxable: product.isTaxable,
    taxRate: product.taxRate,
    tier: tier
      ? { label: tier.label, price: tier.price, defaultQuantity: tier.defaultQuantity }
      : null,
    quantity: options.quantity ?? null,
  }
}

/** Narrowing helper, so callers can branch without repeating the shape. */
export function isUnpriceable<T>(
  result: T | { unpriceable: UnpriceableReason }
): result is { unpriceable: UnpriceableReason } {
  return typeof result === 'object' && result !== null && 'unpriceable' in result
}
