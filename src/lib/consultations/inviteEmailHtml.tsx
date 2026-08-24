import 'server-only'

import { render } from '@react-email/render'

import { ConsultationLinkEmail } from './ConsultationLinkEmail'

/**
 * The HTML the patient sees: the same `ConsultationLinkEmail` template the
 * admin app sends from `POST /api/send-consultation-link`.
 *
 * Rendered here rather than requested from that app, because that endpoint
 * needs an alphamd session and this portal does not hold one.
 */
export async function renderConsultationInviteHtml(options: {
  firstName: string | null
  bookingUrl: string
  eventTypeName: string
}): Promise<string> {
  return render(
    <ConsultationLinkEmail
      firstName={options.firstName?.trim() || ''}
      singleUseCalendlyLink={options.bookingUrl}
      eventTypeName={options.eventTypeName}
    />
  )
}
