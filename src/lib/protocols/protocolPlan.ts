// Explicit `.ts` specifiers: this module is exercised by `npm test`, which runs
// TypeScript through Node's type stripping and needs the real extension.
import type { ProtocolOutcome } from '../labReviews/completion.ts'
import type { DraftMedication } from '../labReviews/reviewDraft.ts'
import {
  couponAsCustomDiscount,
  couponToPricing,
  type AssignedCoupon,
} from './assignedCoupon.ts'
import { pricingBreakdown } from './breakdown.ts'
import { automaticAddons, eligibleDiscounts, type PricingCatalog } from './catalog.ts'
import { formatUsd, type Cents } from './money.ts'
import {
  grandTotal,
  priceAncillaries,
  priceSubscription,
  type AncillarySelection,
  type PricedAncillaries,
  type PricedSubscription,
} from './price.ts'
import {
  ancillarySelection,
  isUnpriceable,
  resolveMedication,
  subscriptionInput,
  type UnpriceableReason,
} from './resolve.ts'

/**
 * What the medications a provider added come to, if anything.
 *
 * This is the decision layer between a lab review and a price. `resolve.ts`
 * answers "which product is this medication", `price.ts` answers "what does this
 * product cost"; this answers the question a provider actually asked, which is
 * "can this protocol be quoted, and if not, why not".
 *
 * **All or nothing.** A protocol is quoted automatically only when *every*
 * medication in it can be priced. One that cannot blocks the whole quote and
 * sends the protocol to staff instead.
 *
 * That rule is stricter than it needs to be and deliberately so. The alternative
 * is to quote what we can and hand the rest over, which produces an email listing
 * a total next to a protocol that is missing an item — and a patient who pays it
 * reasonably believes they have bought everything their provider prescribed. The
 * clinic prescribes a great deal it does not price here ("Other" alone accounts
 * for over a hundred additions a month), so this path will decline often. Staff
 * price every protocol by hand today, so declining costs nothing that is not
 * already being paid; quoting short costs a refund and a phone call.
 *
 * Pure, and that is the point: a provider can be told what will happen while the
 * review is still open, rather than finding out from the summary after they have
 * approved it.
 */

/**
 * Which algorithm priced a protocol, stamped onto `pricing_snapshots`.
 *
 * Every row written before this existed carries null, meaning the admin app's
 * client-side calculator. See the migration for why the distinction is worth a
 * column.
 */
export const PRICING_VERSION = 'provider-v1'

/**
 * The term a protocol from a lab review is quoted at.
 *
 * Monthly, and no provider is asked to choose, because choosing would be a
 * decision with no clinical content taking up space in a clinical form. It costs
 * nothing: `/profile/recommended-protocol` re-derives the three, six and twelve
 * month prices from the snapshot's product, dose and discounts, so the patient
 * still sees every term and still picks one. All the snapshot fixes is the
 * cheapest commitment.
 *
 * Every active subscription product has a monthly plan, so this never fails to
 * resolve. `no-plan-for-term` remains reachable, and stays handled, because that
 * is a fact about today's catalog rather than a guarantee.
 */
export const DEFAULT_TERM_MONTHS = 1

/**
 * Flat add-ons that are part of the product rather than an option on it.
 *
 * `per_unit` add-ons apply on their own — that is the dose surcharge, and
 * `addonsFor` never leaves it to a checkbox. Flat ones normally have to be
 * chosen, and this portal has nothing to choose them with, so the question is
 * which of them would be wrong to omit.
 *
 * The topical surcharge is the answer, and history is unambiguous: all 31 cream
 * and gel snapshots ever written carry it, because the admin app ticks it the
 * moment a topical product is selected. Omitting it would underquote every cream
 * and gel protocol by $50.
 *
 * The two left out are MCT oil and propionate, on the cypionate. Both are
 * formulation preferences rather than surcharges, both are genuinely occasional —
 * 9 and 3 times in 1,053 injectable quotes — and neither is recorded anywhere in
 * a lab review, so there is nothing here to infer them from. A patient who needs
 * one is quoted $50 low and staff correct it, which is the same thing that happens
 * today when an admin forgets the checkbox.
 *
 * Ids rather than a rule about names or counts. A rule would keep working by
 * accident and then quietly stop: "the product's only add-on" gives the right
 * answer today and silently drops $50 the day a second add-on is added to cream.
 * A list fails visibly instead, which is what a list of ids that price things
 * should do.
 */
const MANDATORY_ADDON_IDS = [
  3, // Topical Surcharge — Testosterone Gel
  4, // Topical Surcharge — Testosterone Cream
]

/** Why a medication stopped the protocol being quoted. */
export type BlockReason =
  | UnpriceableReason
  /**
   * A product whose price depends on the dose, added without a dose figure.
   *
   * Not currently reachable: the only products with a dose surcharge are the two
   * injectable testosterones, and those are exactly the two the review doses in
   * weekly milligrams, so the figure is always there. It is checked anyway
   * because that alignment is a coincidence of today's catalog, and the day a
   * surcharge is added to something dosed from a dropdown, this is the difference
   * between declining to quote and quoting the surcharge as zero.
   */
  | 'dose-required'
  /** A second recurring plan in one protocol, which a snapshot cannot hold. */
  | 'second-subscription'

export type PricingBlock = {
  /** As the provider named it, so the sentence staff read matches the chart. */
  medication: string
  dose: string
  reason: BlockReason
  /** The products considered, for `ambiguous` and `withdrawn`. */
  candidates: string[]
}

export type QuotedSubscription = {
  /** `pricing_snapshots.product_id`. */
  productId: number
  /** What went into `selected_addon_ids`. */
  addonIds: number[]
  /** Catalog ids that actually applied (eligible ∩ chosen). */
  selectedDiscountIds: number[]
  couponCode: string | null
  customDiscounts: {
    name: string
    type: 'percentage' | 'fixed'
    scope: 'monthly' | 'first_month' | 'overall' | 'target_price'
    value: number
  }[]
  priced: PricedSubscription
}

export type UnusedDiscount = {
  name: string
  reason: string
}

export type ProtocolPricing = {
  selectedDiscountIds?: number[]
  coupon?: AssignedCoupon | null
}

/**
 * A medication as the protocol lists it for the patient.
 *
 * `category` is what `/profile/recommended-protocol` renders as a badge, and it
 * keys its colours off exactly these two words. It is derived from which pricing
 * table the medication resolved in rather than read from
 * `medications_list.medication_category`, which holds the same two values: the
 * resolution is the thing that decided how the patient is charged, so deriving it
 * cannot disagree with the price beside it.
 */
export type QuotedMedication = {
  name: string
  category: 'subscription' | 'ancillary'
  /** The level and the instruction, which is all the patient page shows. */
  instructions: string
}

export type ProtocolQuote = {
  /** Null for a protocol of ancillaries alone, which is a real thing to sell. */
  subscription: QuotedSubscription | null
  ancillaryProductIds: number[]
  ancillaries: PricedAncillaries
  /** Everything being prescribed, in the order the provider added it. */
  medications: QuotedMedication[]
  /** What the patient pays today for both halves together. */
  grandTotal: Cents
  /** Chosen Catalog Discounts this Subscription cannot take. */
  unusedDiscounts: UnusedDiscount[]
  /** Catalog Discounts this Subscription may be given. */
  offeredDiscounts: { id: number; name: string }[]
}

export type ProtocolPlan =
  /** No medication was added, so there is no protocol to send. */
  | { kind: 'none' }
  /** At least one medication a human has to price. Nothing is sent. */
  | { kind: 'blocked'; blocks: PricingBlock[] }
  | { kind: 'quote'; quote: ProtocolQuote }

/** The medications worth pricing: named, and with a catalog row behind the name.
 *  A row typed into a draft before the picker existed has no id to resolve. */
function priceable(medications: DraftMedication[]) {
  return medications.filter((med) => med.name.trim())
}

/** The level and the instruction it works out to, which is what the patient
 *  reads. Either can be absent: a catalog dose is already an instruction, and a
 *  calculated one is a level with a sig under it. */
function instructionsFor(med: DraftMedication): string {
  return [med.dose.trim(), med.sig.trim()].filter(Boolean).join(' — ')
}

export function planProtocol(
  catalog: PricingCatalog,
  medications: DraftMedication[],
  now: Date = new Date(),
  pricing: ProtocolPricing = {}
): ProtocolPlan {
  const added = priceable(medications)
  if (added.length === 0) return { kind: 'none' }

  const blocks: PricingBlock[] = []
  let subscription: QuotedSubscription | null = null
  const ancillaryProductIds: number[] = []
  const ancillarySelections: AncillarySelection[] = []
  const quoted: QuotedMedication[] = []

  for (const med of added) {
    const block = (reason: BlockReason, candidates: string[] = []) => {
      blocks.push({ medication: med.name.trim(), dose: med.dose.trim(), reason, candidates })
    }

    // Typed free text with no catalog row behind it. Same outcome as a medication
    // the clinic does not price, and the same sentence in front of staff.
    if (med.medicationId === null) {
      block('not-in-catalog')
      continue
    }

    const resolution = resolveMedication(catalog, med.medicationId)

    if (resolution.kind === 'unpriceable') {
      block(resolution.reason, resolution.candidates)
      continue
    }

    if (resolution.kind === 'subscription') {
      // A snapshot holds one product, one dose and one term, so a second
      // recurring plan has nowhere to go. Blocking rather than quoting the first
      // and mentioning the second: the patient would be shown one price for two
      // prescriptions.
      if (subscription) {
        block('second-subscription')
        continue
      }

      const dosed = automaticAddons(resolution.product).length === 0 || med.dosageMg !== null
      if (!dosed) {
        block('dose-required')
        continue
      }

      // Only the mandatory flat ones are named. `addonsFor` reads every dose
      // surcharge off the product itself, so listing those here would change
      // nothing except what the snapshot claims was selected.
      const addonIds = MANDATORY_ADDON_IDS.filter((id) =>
        resolution.product.addons.some((addon) => addon.id === id && addon.isActive)
      )

      const input = subscriptionInput(
        catalog,
        {
          product: resolution.product,
          durationMonths: DEFAULT_TERM_MONTHS,
          dosageMg: med.dosageMg ?? 0,
          // The provider's own words when the dose is not a number of
          // milligrams — pump clicks, or a tablet's instruction. `dosageLabel`
          // falls back to `${dosageMg}mg` only when this is absent, and `0mg`
          // on a quote would be worse than the sentence they wrote.
          dosageLabel: med.dosageMg === null ? med.dose.trim() || null : null,
          selectedDiscountIds: pricing.selectedDiscountIds ?? [],
          selectedAddonIds: addonIds,
          ...couponPricing(pricing.coupon),
        },
        now
      )

      if (isUnpriceable(input)) {
        block(input.unpriceable)
        continue
      }

      const chosen = pricing.selectedDiscountIds ?? []
      const offered = new Set(
        eligibleDiscounts(catalog, resolution.product, now).map((discount) => discount.id)
      )
      const appliedIds = chosen.filter((id) => offered.has(id))
      const custom = pricing.coupon ? couponAsCustomDiscount(pricing.coupon) : null

      subscription = {
        productId: resolution.product.id,
        addonIds,
        selectedDiscountIds: appliedIds,
        couponCode: pricing.coupon?.code ?? null,
        customDiscounts: custom ? [custom] : [],
        priced: priceSubscription(input, now),
      }
      quoted.push({
        name: med.name.trim(),
        category: 'subscription',
        instructions: instructionsFor(med),
      })
      continue
    }

    const selection = ancillarySelection(resolution.product)
    if (isUnpriceable(selection)) {
      block(selection.unpriceable, [resolution.product.name])
      continue
    }

    ancillaryProductIds.push(resolution.product.id)
    ancillarySelections.push(selection)
    quoted.push({ name: med.name.trim(), category: 'ancillary', instructions: instructionsFor(med) })
  }

  if (blocks.length) return { kind: 'blocked', blocks }

  const ancillaries = priceAncillaries(ancillarySelections)
  const unusedDiscounts = unusedSelections(catalog, subscription, pricing, now)
  const product = subscription
    ? catalog.subscriptions.find((row) => row.id === subscription.productId)
    : null

  return {
    kind: 'quote',
    quote: {
      subscription,
      ancillaryProductIds,
      ancillaries,
      medications: quoted,
      grandTotal: grandTotal(subscription?.priced ?? null, ancillaries),
      unusedDiscounts,
      offeredDiscounts: product
        ? eligibleDiscounts(catalog, product, now).map((discount) => ({
            id: discount.id,
            name: discount.name,
          }))
        : [],
    },
  }
}

function couponPricing(coupon: AssignedCoupon | null | undefined) {
  if (!coupon) return { targetPrice: null, extraDiscounts: [] }
  const { targetPrice, discounts } = couponToPricing(coupon)
  return { targetPrice, extraDiscounts: discounts }
}

function unusedSelections(
  catalog: PricingCatalog,
  subscription: QuotedSubscription | null,
  pricing: ProtocolPricing,
  now: Date
): UnusedDiscount[] {
  const chosen = pricing.selectedDiscountIds ?? []
  const unused: UnusedDiscount[] = []

  if (!subscription) {
    for (const id of chosen) {
      unused.push({
        name: catalog.discounts.find((discount) => discount.id === id)?.name ?? `Discount ${id}`,
        reason: 'there is no subscription on this quote',
      })
    }
    if (pricing.coupon) {
      unused.push({
        name: `Coupon ${pricing.coupon.code}`,
        reason: 'there is no subscription on this quote',
      })
    }
    return unused
  }

  const product = catalog.subscriptions.find((row) => row.id === subscription.productId)
  if (!product) return unused

  const offered = new Set(eligibleDiscounts(catalog, product, now).map((discount) => discount.id))
  for (const id of chosen) {
    if (offered.has(id)) continue
    unused.push({
      name: catalog.discounts.find((discount) => discount.id === id)?.name ?? `Discount ${id}`,
      reason: `not offered on ${product.name}`,
    })
  }

  return unused
}

/**
 * Why a medication could not be priced, written for whoever has to price it.
 *
 * Addressed to staff rather than to a clinician: it names the medication, says
 * what is in the way, and stops. What to do about it is not a decision this
 * module gets to make — an ambiguous Sermorelin needs the patient's state, a
 * withdrawn medication needs a conversation with the provider.
 */
export function blockLine(block: PricingBlock): string {
  const named = block.dose ? `${block.medication} (${block.dose})` : block.medication
  const candidates = block.candidates.join(' or ')

  switch (block.reason) {
    case 'not-in-catalog':
      return `${named} — not priced automatically; quote it by hand.`
    case 'withdrawn':
      return `${named} — ${candidates || 'the matching product'} is no longer sold; check with the provider before quoting.`
    case 'ambiguous':
      return `${named} — more than one product matches (${candidates}); the price depends on which, so pick one.`
    case 'no-plan-for-term':
      return `${named} — not sold monthly; quote a term it is sold at.`
    case 'tier-required':
      return `${named} — the price depends on the strength; confirm which with the provider.`
    case 'dose-required':
      return `${named} — the price depends on the dose and none was recorded; confirm it with the provider.`
    case 'second-subscription':
      return `${named} — a second recurring plan, which a single quote cannot hold; price it separately.`
  }
}

/**
 * The caveat on a quote that still has no Catalog Discount or Coupon on it.
 *
 * A patient entitled to military or first responder who was quoted list is
 * charged too much, and a snapshot with empty `selected_discount_ids` looks like
 * a deliberate choice. Saying so on the chart is the cheap half. The Discounts
 * step is the other half — and this sentence drops off once something applied.
 */
export const DISCOUNT_NOTICE =
  'Quoted at list price with no discounts applied. If the patient qualifies for one, apply it before billing.'

/**
 * A plan reduced to what the review's chart note and confirmation screen need.
 *
 * The narrow point where pricing meets the rest of the review. `completion.ts` is
 * pure and knows nothing about a catalog, so it declares the shape and this
 * fills it in — which also means the provider's preview and the note that gets
 * written are the same sentences, built once.
 *
 * Null for a plan with no medications in it, so a review that added none reads
 * exactly as it did before any of this existed.
 */
export function protocolOutcome(plan: ProtocolPlan): ProtocolOutcome | null {
  if (plan.kind === 'none') return null
  if (plan.kind === 'blocked') {
    return { kind: 'handed-off', reasons: plan.blocks.map(blockLine) }
  }

  const priced = plan.quote.subscription?.priced
  const applied =
    (priced?.monthlyDiscountBreakdown.length ?? 0) +
      (priced?.overallDiscountBreakdown.length ?? 0) >
    0

  return {
    kind: 'quote',
    lines: pricingBreakdown(plan.quote),
    total: formatUsd(plan.quote.grandTotal),
    caveat: applied ? '' : DISCOUNT_NOTICE,
    unusedDiscounts: plan.quote.unusedDiscounts.map(
      (item) => `${item.name} — ${item.reason}`
    ),
  }
}
