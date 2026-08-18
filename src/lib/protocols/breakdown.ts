// Explicit `.ts` specifiers: this module is exercised by `npm test`, which runs
// TypeScript through Node's type stripping and needs the real extension.
import { formatUsd } from './money.ts'
import type { AncillaryLine, PricedSubscription } from './price.ts'
import type { ProtocolQuote } from './protocolPlan.ts'

/**
 * A quote written out line by line, for whoever is reading it.
 *
 * Its own module because three different readers need the same lines and none of
 * them may see different ones: the patient's email, the chart note, and the
 * confirmation screen the provider approves before any of it happens. Same reason
 * `doseChangeLines` lives beside the record it produces — a preview assembled
 * anywhere else would eventually disagree with the email, and what disagreed would
 * be a price.
 *
 * Formatted to match the admin app's breakdown, down to `Included` in place of a
 * zero, because a patient comparing this to their last quote should not have to
 * work out whether anything changed but the numbers.
 */
export function pricingBreakdown(quote: ProtocolQuote): string[] {
  const lines: string[] = []
  const sub = quote.subscription?.priced

  if (sub && sub.totalDueToday > 0) {
    lines.push(...subscriptionLines(sub))
  }

  if (quote.ancillaries.lines.length > 0) {
    if (lines.length) lines.push('')
    lines.push('Ancillary Medications (One-time):')
    for (const line of quote.ancillaries.lines) lines.push(...ancillaryLines(line))
    lines.push(`Ancillary Total: ${formatUsd(quote.ancillaries.total)}`)
  }

  return lines
}

function subscriptionLines(sub: PricedSubscription): string[] {
  const lines = [sub.productName]

  if (sub.dosage && sub.dosage !== 'N/A') lines.push(`Dosage: ${sub.dosage}`)
  if (sub.durationLabel && sub.durationLabel !== 'N/A') {
    lines.push(`Billing Period: ${sub.durationLabel}`)
  }

  lines.push(`Base Price: ${formatUsd(sub.monthlyPrice)}/mo`)

  for (const addon of sub.addonBreakdown) {
    lines.push(`${addon.name}: +${formatUsd(addon.amount)}/mo`)
  }

  // A prepay term is quoted as a term total as well as a monthly rate, so the
  // figure on the card is one the patient has already seen written down.
  if (sub.durationMonths > 1) {
    lines.push(`${sub.durationLabel} Total: ${formatUsd(sub.billingPeriodTotal)}`)
  }

  if (sub.taxRate > 0) {
    lines.push(`Tax (${percent(sub.taxRate)}): ${formatUsd(sub.taxAmount)}`)
  }

  lines.push(`Subscription Total: ${formatUsd(sub.totalDueToday)}`)

  return lines
}

function ancillaryLines(line: AncillaryLine): string[] {
  const tier = line.tierLabel ? ` (${line.tierLabel})` : ''
  // `Included` rather than `$0.00`: anastrozole comes with the protocol, and a
  // zero beside it reads like a mistake.
  const amount = line.subtotal > 0 ? formatUsd(line.subtotal) : 'Included'

  const lines = [`${line.name}${tier}: ${amount}`]

  if (line.quantity && line.quantity > 0) {
    const fee = line.processingFee > 0 ? ` + ${formatUsd(line.processingFee)} fee` : ''
    lines.push(`  ${line.quantity} x ${formatUsd(line.unitPrice)}${fee}`)
  }

  if (line.taxAmount > 0) {
    lines.push(`  Tax (${percent(line.taxRate)}): ${formatUsd(line.taxAmount)}`)
  }

  return lines
}

/** `6.5%` — one decimal place, as the admin app writes it. */
export function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}
