import 'server-only'

import { render } from '@react-email/render'

import { PricingProtocolEmail } from './PricingProtocolEmail'
import type { ProtocolEmail } from './protocolEmail'

/**
 * The HTML the patient sees: the same `PricingProtocolEmail` template the
 * admin app sends from `POST /api/send-pricing-email`.
 *
 * Rendered here rather than requested from that app, because that endpoint
 * needs an alphamd session and does not own the quote. The plaintext and the
 * dollar payload are composed next door in `protocolEmail`.
 */
export async function renderProtocolEmailHtml(
  email: ProtocolEmail,
  firstName: string | null
): Promise<string> {
  return render(
    <PricingProtocolEmail
      firstName={firstName?.trim() || undefined}
      emailContent={email.text}
      pricingData={email.pricingData}
    />
  )
}
