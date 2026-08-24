// Explicit `.ts` specifiers: this module is exercised by `npm test`, which runs
// TypeScript through Node's type stripping and needs the real extension.
import { pricingBreakdown } from './breakdown.ts'
import { addCents, formatUsd, rateOf, type Cents } from './money.ts'
import type { PricedSubscription } from './price.ts'
import type { ProtocolQuote } from './protocolPlan.ts'
import { toStructuredPricing, type StructuredPricingData } from './structuredPricing.ts'

/**
 * The email that carries a recommended protocol and its price.
 *
 * Ported from the admin app's `PricingProtocolEmail` and the plain-text body
 * `POSPricingModal` builds to go with it. Pure — takes a quote, returns strings —
 * so the wording a patient receives is reviewable in a diff and the arithmetic
 * shown to them is testable without sending mail.
 *
 * Three things are kept deliberately:
 *
 *  - **The subject line.** Patients have had this one before and support staff
 *    search for it.
 *  - **The section headings.** `RECOMMENDED PROTOCOL:`, `PRICING BREAKDOWN:` and
 *    the rest, in the same order, because the previous email is the one the
 *    patient will compare this to.
 *  - **`BANK STATEMENT:`**, which is the section that says what the *recurring*
 *    charge will be. It reads like boilerplate and is the most valuable paragraph
 *    in the message: a patient who does not expect the second charge disputes it.
 *
 * What is not kept is the coupon wording, because this portal applies no
 * discounts. The HTML is not composed here: `renderProtocolEmailHtml` feeds
 * this text and `pricingData` into the ported `PricingProtocolEmail` template,
 * which is the letter the admin app sends.
 */

export const PROTOCOL_SUBJECT =
  '[Action Required] - AlphaMD recommended protocol and pricing details'

/** `contact@alphamd.org`, not the `noreply` address the consultation invite uses.
 *  A quote invites a reply; a booking link does not. */
export const PROTOCOL_FROM = 'AlphaMD <contact@alphamd.org>'

const SUPPORT_EMAIL = 'contact@alphamd.org'

/**
 * Where the patient goes to accept.
 *
 * The same page the admin app's email links to, and it is not snapshot-specific:
 * it reads the patient's latest unapproved protocol, re-derives the other terms
 * from it, and takes the payment. Which is why nothing here has to mint a
 * per-quote URL.
 */
function protocolUrl(): string {
  const base = process.env.NEXT_PUBLIC_DEFAULT_URL || 'https://www.alphamd.org'
  return `${base.replace(/\/$/, '')}/profile/recommended-protocol`
}

/**
 * The supply interval quoted in `HOW IT WORKS:`.
 *
 * Ten weeks, which is what the admin app falls back to when the cart carries no
 * shipping configuration — and a lab review never carries one, so this is always
 * the figure. It is general copy about how the subscription works rather than a
 * promise about this protocol's shipments.
 */
const SUPPLY_WEEKS = 10

/**
 * What the patient will be charged on every billing after this one.
 *
 * The billing period total plus tax, rather than what is due today. The two are
 * the same figure for a protocol quoted from here, because nothing applies a
 * one-off discount — but they are not the same thing, and stating today's total
 * as the recurring one is exactly the mistake that produces a disputed charge the
 * first time a coupon is involved.
 */
function recurringCharge(sub: PricedSubscription): Cents {
  return addCents(sub.billingPeriodTotal, rateOf(sub.billingPeriodTotal, sub.taxRate))
}

export type ProtocolEmail = {
  subject: string
  text: string
  /** Dollars, in the shape `PricingProtocolEmail` already knows. */
  pricingData: StructuredPricingData
}

export function protocolEmail(options: {
  firstName: string | null
  quote: ProtocolQuote
}): ProtocolEmail {
  const { quote } = options
  const greeting = options.firstName?.trim() ? `Hello ${options.firstName.trim()},` : 'Hello,'
  const sub = quote.subscription?.priced ?? null

  const sections: string[] = [
    greeting,
    'Thank you for your consultation. Based on your lab results, our discussion and your health goals, your provider recommends the following protocol:',
    [
      'RECOMMENDED PROTOCOL:',
      ...quote.medications.map((med) =>
        med.instructions ? `• ${med.name}: ${med.instructions}` : `• ${med.name}`
      ),
    ].join('\n'),
    ['PRICING BREAKDOWN:', '', ...pricingBreakdown(quote)].join('\n'),
    `Total Due Today: ${formatUsd(quote.grandTotal)}`,
  ]

  if (sub) {
    sections.push(
      [
        'PAYMENT TERMS:',
        `The pricing above reflects ${sub.durationLabel} billing.`,
        `To review all payment options, log in to your account at ${protocolUrl()}`,
      ].join('\n')
    )

    sections.push(
      [
        'HOW IT WORKS:',
        'Membership Billing | Monthly* | Access to your medical provider, clinical oversight by your provider, lab reviews, and spreading out the cost of your medication.',
        `Medication Shipping | Every ${SUPPLY_WEEKS}-${SUPPLY_WEEKS + 2} Weeks** | A supply of your medication and all injection supplies.`,
        `Ancillary Meds (one-off orders) | As Needed | These are not auto-reordered and you will be asked if you want to order again or you can request it to be ordered by emailing ${SUPPORT_EMAIL}.`,
        '*If you choose a prepayment option (6-month or 12-month), billing will occur on that interval instead.',
        `**First time monthly subscribers will receive approximately 6 weeks worth of medication for their first shipment, then ${SUPPLY_WEEKS}-${SUPPLY_WEEKS + 2} weeks after.`,
      ].join('\n')
    )

    sections.push(
      [
        'SEAMLESS SUPPLY:',
        'Our system is designed to automatically process your next shipment approximately one week before your current supply runs out. This ensures that even with shipping times, you have your next supply on hand when you need it.',
      ].join('\n')
    )

    sections.push(bankStatement(quote, sub))
  }

  sections.push(
    [
      'FIRST ORDER:',
      'Processing Time: 2-3 business days',
      'Shipping Time: 2 business days via UPS or FedEx',
      'Tracking: You will receive an automated email with your tracking number as soon as the pharmacy labels your package.',
    ].join('\n')
  )

  sections.push(
    `To confirm your protocol and begin treatment, log in to your account: ${protocolUrl()}`,
    `Questions? Reply to this email or write to ${SUPPORT_EMAIL}.`,
    'Best regards,\nThe AlphaMD Team'
  )

  return {
    subject: PROTOCOL_SUBJECT,
    text: sections.join('\n\n'),
    pricingData: toStructuredPricing(quote),
  }
}

function bankStatement(quote: ProtocolQuote, sub: PricedSubscription): string {
  const includesAncillaries = quote.ancillaries.total > 0

  const opening = [
    `Your total due today is ${formatUsd(quote.grandTotal)}`,
    includesAncillaries
      ? ` (includes your ${sub.durationLabel} subscription and one-time ancillary medications)`
      : '',
    '. See the pricing breakdown listed above for details.',
  ].join('')

  return [
    'BANK STATEMENT:',
    opening,
    `After today, you will see a charge of ${formatUsd(recurringCharge(sub))} ${billingInterval(sub.durationMonths)}. Think of this as your "All-Inclusive Access" membership. This fee keeps your prescription active and your medical provider available to you.`,
  ].join('\n')
}

/**
 * `every month`, or `every 3 months`.
 *
 * The one place this email deliberately does not reproduce the admin app, which
 * lowercases the duration label and writes `every monthly`. Nobody is comparing
 * that clause word for word against a previous email, and the sentence it appears
 * in is the one that stops a patient disputing their second charge — it is worth
 * having in English.
 */
function billingInterval(months: number): string {
  return months === 1 ? 'every month' : `every ${months} months`
}
