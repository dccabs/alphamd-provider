// Explicit `.ts` specifiers: this module is exercised by `npm test`, which runs
// TypeScript through Node's type stripping and needs the real extension.
import { toDollars, type Cents } from './money.ts'
import { ancillaryLineJson } from './price.ts'
import { PRICING_VERSION, type ProtocolQuote } from './protocolPlan.ts'
import type { AppliedDiscount } from './discounts.ts'
import type { LineItem } from './price.ts'

/**
 * A quote in the two shapes the database keeps it in.
 *
 * `pricing_snapshots` is the financial record: the numbers a patient was shown,
 * frozen, so that what they agreed to is still readable after the catalog moves.
 * `medication_protocols` is the clinical one: what was prescribed, and whether
 * they have accepted it.
 *
 * Pure on purpose. These two payloads are the whole interface between this app
 * and alphamd's patient-facing pages — `/pricing/[id]` and
 * `/profile/recommended-protocol` read these keys straight out of the columns —
 * so getting a key name wrong is a blank price on a page a patient is being asked
 * to pay from. Building them here means the shape is asserted in a unit test
 * rather than discovered in production.
 *
 * **Dollars, not cents.** Every money column is `numeric` and every reader
 * expects dollars, so this is the boundary where cents are converted, and the
 * only one.
 */

/** `{ name, amount }` in dollars, which is how both breakdowns are stored. */
function breakdown(lines: (LineItem | AppliedDiscount)[]): Record<string, unknown>[] {
  return lines.map((line) => ({ name: line.name, amount: toDollars(line.amount) }))
}

/**
 * The sentinel a protocol with no subscription is recorded under.
 *
 * `pricing_snapshots` has no nullable product: the columns describing the
 * recurring plan are NOT NULL with no default, and the admin app fills them with
 * this name and zeroes when a patient is only buying ancillaries. Preserved
 * because `/pricing/[id]` keys its "one-time medications only" wording off
 * exactly this.
 */
export const ANCILLARY_ONLY = 'Ancillary Only'

/**
 * The `pricing_snapshots` row for a quote.
 *
 * Column for column what the admin app's `POST /api/admin/subscription-pricing/
 * snapshots` writes, with two deliberate differences:
 *
 *  - `pricing_version` is stamped, so a later reader can tell which algorithm
 *    produced the numbers. Every row written before this app existed has null.
 *  - Discount and coupon columns come from the quote when the Provider chose
 *    them. An unchosen quote still writes empty arrays, matching the old gap.
 *
 * `plan_id` is left null, matching the admin app, which has never written it.
 * Nothing reads the column.
 */
export function snapshotRow(
  quote: ProtocolQuote,
  options: { createdBy: string }
): Record<string, unknown> {
  const subscription = quote.subscription?.priced ?? null

  return {
    created_by: options.createdBy,
    pricing_version: PRICING_VERSION,

    // The recurring half, or the sentinel and zeroes when there is not one.
    product_name: subscription?.productName ?? ANCILLARY_ONLY,
    product_id: quote.subscription?.productId ?? null,
    plan_id: null,
    dosage: subscription?.dosage ?? 'N/A',
    dosage_mg: subscription?.dosageMg ?? null,
    duration_months: subscription?.durationMonths ?? 0,
    duration_label: subscription?.durationLabel ?? 'N/A',
    monthly_price: dollars(subscription?.monthlyPrice),
    addon_breakdown: breakdown(subscription?.addonBreakdown ?? []),
    price_before_discounts: dollars(subscription?.priceBeforeDiscounts),
    monthly_discount_breakdown: breakdown(subscription?.monthlyDiscountBreakdown ?? []),
    monthly_after_discounts: dollars(subscription?.monthlyAfterDiscounts),
    billing_period_total: dollars(subscription?.billingPeriodTotal),
    overall_discount_breakdown: breakdown(subscription?.overallDiscountBreakdown ?? []),
    subtotal_after_all_discounts: dollars(subscription?.subtotalAfterAllDiscounts),
    tax_rate: subscription?.taxRate ?? 0,
    tax_amount: dollars(subscription?.taxAmount),
    total_due_today: dollars(subscription?.totalDueToday),
    total_per_month: dollars(subscription?.totalPerMonth),
    next_billing_date: subscription?.nextBillingDate ?? null,

    selected_addon_ids: quote.subscription?.addonIds ?? [],
    selected_discount_ids: quote.subscription?.selectedDiscountIds ?? [],
    custom_addons: [],
    custom_discounts: quote.subscription?.customDiscounts ?? [],
    coupon_code_applied: quote.subscription?.couponCode ?? null,

    // The one-off half.
    ancillary_line_items: quote.ancillaries.lines.map(ancillaryLineJson),
    ancillary_subtotal: toDollars(quote.ancillaries.subtotal),
    ancillary_tax_amount: toDollars(quote.ancillaries.taxAmount),
    ancillary_total: toDollars(quote.ancillaries.total),

    grand_total: toDollars(quote.grandTotal),
  }
}

/** Zero rather than null for a protocol with no subscription, matching the admin
 *  app: these columns are NOT NULL and a missing plan is a plan costing nothing. */
function dollars(amount: Cents | undefined): number {
  return toDollars(amount ?? (0 as Cents))
}

/**
 * The `medication_protocols.data` payload.
 *
 * `snapshotId` is duplicated inside the jsonb as well as being a column, because
 * that is where the admin app put it and `payment-agreement.ts` reads it from the
 * body it is handed rather than from the row. Keeping both means a protocol from
 * here is accepted by the same acceptance path as one from there.
 */
export function protocolData(
  quote: ProtocolQuote,
  options: { snapshotId: string; labReviewId: string }
): Record<string, unknown> {
  return {
    snapshotId: options.snapshotId,
    medications: quote.medications.map((med) => ({
      name: med.name,
      category: med.category,
      dosageSummary: { instructions: med.instructions },
    })),
    // Not read by anything in alphamd. Recorded because a protocol that cannot say
    // which review produced it is a protocol nobody can explain six months later,
    // and the column beside it only carries the id.
    source: { labReview: options.labReviewId, pricingVersion: PRICING_VERSION },
  }
}

/** Where staff open the stored quote. Same path the protocol chart note uses. */
export function pricingSnapshotHref(
  snapshotId: string,
  base = process.env.NEXT_PUBLIC_DEFAULT_URL || 'https://www.alphamd.org'
): string {
  return `${base.replace(/\/$/, '')}/pricing/${snapshotId}`
}

/** The completion note plus the snapshot link, when a quote actually went out. */
export function withPricingSnapshot(note: string, snapshotId: string | null | undefined): string {
  if (!snapshotId?.trim()) return note
  return `${note}\n\nPricing snapshot: ${pricingSnapshotHref(snapshotId.trim())}`
}
