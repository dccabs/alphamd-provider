import 'server-only'

/**
 * The single Calendly call this portal makes: minting a **single-use** scheduling
 * link.
 *
 * Ported from the main app's `createSingleUseSchedulingLink`. `max_event_count: 1`
 * is what makes it single-use — the link dies once the patient books, so a
 * forwarded email cannot fill a second slot on a provider's calendar.
 *
 * Prefilling the patient's name and email onto the booking URL is not cosmetic:
 * the booking webhook matches the invitee back to a `user_list` row by email, and
 * a patient who types a different address books an appointment that never links to
 * their chart.
 */

const CALENDLY_API = 'https://api.calendly.com'

export function calendlyConfigured(): boolean {
  return Boolean(process.env.CALENDLY_AUTH_TOKEN)
}

export type SchedulingLink =
  | { ok: true; url: string; expiresAt: string | null }
  | { ok: false; error: string }

export async function createSingleUseSchedulingLink(options: {
  eventTypeId: string
  /** Prefilled on the booking form so the invitee matches the chart. */
  email: string | null
  name: string | null
}): Promise<SchedulingLink> {
  const token = process.env.CALENDLY_AUTH_TOKEN
  if (!token) {
    return { ok: false, error: 'Calendly is not configured in this environment.' }
  }

  let response: Response
  try {
    response = await fetch(`${CALENDLY_API}/scheduling_links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        max_event_count: 1,
        owner: `${CALENDLY_API}/event_types/${options.eventTypeId}`,
        owner_type: 'EventType',
      }),
    })
  } catch (error) {
    console.error('[calendly] request failed:', error)
    return { ok: false, error: 'Could not reach Calendly.' }
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error(`[calendly] ${response.status}: ${detail}`)
    return {
      ok: false,
      error:
        response.status === 404
          ? 'That consultation type no longer exists in Calendly.'
          : 'Calendly rejected the request. Nothing was sent to the patient.',
    }
  }

  const payload = (await response.json().catch(() => null)) as {
    resource?: { booking_url?: string; expires_at?: string }
  } | null

  const bookingUrl = payload?.resource?.booking_url
  if (!bookingUrl) {
    return { ok: false, error: 'Calendly did not return a booking link.' }
  }

  return {
    ok: true,
    url: withPrefill(bookingUrl, options),
    expiresAt: payload?.resource?.expires_at ?? null,
  }
}

function withPrefill(
  bookingUrl: string,
  options: { email: string | null; name: string | null }
): string {
  try {
    const url = new URL(bookingUrl)
    if (options.email) url.searchParams.set('email', options.email)
    if (options.name) url.searchParams.set('name', options.name)
    return url.toString()
  } catch {
    // A URL Calendly returned that does not parse is not worth failing the whole
    // request over — the unprefilled link still books an appointment.
    return bookingUrl
  }
}
