// Explicit `.ts` specifiers: this module is exercised by `npm test`.
import { toDollars, type Cents } from './money.ts'
import type { ProtocolQuote } from './protocolPlan.ts'

/**
 * The dollar payload `PricingProtocolEmail` renders.
 *
 * Copied from alphamd's `StructuredPricingData` rather than imported, because
 * the two apps are separate repos. The field names and units (dollars, not
 * cents; snake_case on ancillary lines) are what that template reads, so a
 * rename here is a blank row on the email the patient compares to their last
 * one.
 */

export type PricingLineItemData = {
  name: string
  amount: number
}

export type AncillaryLineItemData = {
  name: string
  tier_label: string | null
  quantity: number | null
  unit_price: number
  processing_fee: number
  subtotal: number
  is_taxable: boolean
  tax_rate: number
  tax_amount: number
}

export type StructuredPricingData = {
  subscription: {
    productName: string
    dosage: string
    durationMonths: number
    durationLabel: string
    monthlyPrice: number
    addonBreakdown: PricingLineItemData[]
    priceBeforeDiscounts: number
    monthlyDiscountBreakdown: PricingLineItemData[]
    monthlyAfterDiscounts: number
    billingPeriodTotal: number
    overallDiscountBreakdown: PricingLineItemData[]
    subtotalAfterAllDiscounts: number
    taxRate: number
    taxAmount: number
    totalDueToday: number
    totalPerMonth: number
    nextBillingDate: string
  } | null
  ancillary: {
    lineItems: AncillaryLineItemData[]
    subtotal: number
    taxAmount: number
    total: number
  }
  grandTotal: number
}

function dollarsLine(line: { name: string; amount: Cents }): PricingLineItemData {
  return { name: line.name, amount: toDollars(line.amount) }
}

/**
 * The quote, in the units and keys the POS email template already understands.
 *
 * A subscription that comes to nothing is null rather than a row of zeroes —
 * matching the admin app, which drops the subscription block when
 * `totalDueToday` is 0 so an ancillary-only protocol does not grow a fake plan.
 */
export function toStructuredPricing(quote: ProtocolQuote): StructuredPricingData {
  const priced = quote.subscription?.priced ?? null
  const due = priced ? toDollars(priced.totalDueToday) : 0

  return {
    subscription:
      priced && due > 0
        ? {
            productName: priced.productName,
            dosage: priced.dosage,
            durationMonths: priced.durationMonths,
            durationLabel: priced.durationLabel,
            monthlyPrice: toDollars(priced.monthlyPrice),
            addonBreakdown: priced.addonBreakdown.map(dollarsLine),
            priceBeforeDiscounts: toDollars(priced.priceBeforeDiscounts),
            monthlyDiscountBreakdown: priced.monthlyDiscountBreakdown.map(dollarsLine),
            monthlyAfterDiscounts: toDollars(priced.monthlyAfterDiscounts),
            billingPeriodTotal: toDollars(priced.billingPeriodTotal),
            overallDiscountBreakdown: priced.overallDiscountBreakdown.map(dollarsLine),
            subtotalAfterAllDiscounts: toDollars(priced.subtotalAfterAllDiscounts),
            taxRate: priced.taxRate,
            taxAmount: toDollars(priced.taxAmount),
            totalDueToday: due,
            totalPerMonth: toDollars(priced.totalPerMonth),
            nextBillingDate: priced.nextBillingDate,
          }
        : null,
    ancillary: {
      lineItems: quote.ancillaries.lines.map((line) => ({
        name: line.name,
        tier_label: line.tierLabel,
        quantity: line.quantity,
        unit_price: toDollars(line.unitPrice),
        processing_fee: toDollars(line.processingFee),
        subtotal: toDollars(line.subtotal),
        is_taxable: line.isTaxable,
        tax_rate: line.taxRate,
        tax_amount: toDollars(line.taxAmount),
      })),
      subtotal: toDollars(quote.ancillaries.subtotal),
      taxAmount: toDollars(quote.ancillaries.taxAmount),
      total: toDollars(quote.ancillaries.total),
    },
    grandTotal: toDollars(quote.grandTotal),
  }
}
