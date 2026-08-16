// Explicit `.ts` specifier, as in `reviewDraft.ts`: this module is exercised by
// `npm test`, which runs TypeScript through Node's type stripping.
import { eventTypeById } from './eventTypes.ts'

/**
 * A consultation invitation composed inside a review.
 *
 * Singular, unlike `doseChanges` and `labOrders`. A review asks the patient in for
 * one conversation; two links to two event types would have them book twice for
 * the same one.
 *
 * ## The link is minted here, not at approval
 *
 * `bookingUrl` is filled when the provider attaches the request, by a Calendly call
 * from the dialog. Minting at approval instead meant the one step that depends on a
 * third party ran *after* the review row had already been flipped to `finished`, so
 * an outage could only be reported as a warning about an invitation that never went
 * out. Minting while the flyout is open puts that failure somewhere the provider can
 * simply try again.
 *
 * It is safe to hold: a single-use link dies on first booking or after ninety days,
 * which is far longer than a draft lives. And it is not *shown* to the provider —
 * approving is still what tells the patient anything, so there is deliberately
 * nothing to copy out of the flyout beforehand.
 */

export type ConsultRequest = {
  eventTypeId: string
  /** Replaces the invite email's default line about going over their results. */
  message: string
  /** The single-use Calendly link. Empty on a request staged by an older build,
   *  which `requestConsultation` mints for at approval instead. */
  bookingUrl: string
  /** When Calendly says the link stops working, when it says at all. */
  expiresAt: string | null
}

/**
 * A request read back out of `lab_reviews.draft`.
 *
 * Structural only, like `parseOrders`. An `eventTypeId` that is no longer in the
 * catalogue is **kept** rather than dropped: `validateConsultRequest` then refuses
 * the completion by name, which is a provider being told to pick again. Dropping
 * it here would silently discard the one decision this object exists to record,
 * and the review would finish having invited nobody.
 */
export function parseConsultRequest(value: unknown): ConsultRequest | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as Record<string, unknown>
  const eventTypeId = typeof raw.eventTypeId === 'string' ? raw.eventTypeId.trim() : ''
  if (!eventTypeId) return null

  return {
    eventTypeId,
    message: typeof raw.message === 'string' ? raw.message : '',
    bookingUrl: typeof raw.bookingUrl === 'string' ? raw.bookingUrl.trim() : '',
    expiresAt: typeof raw.expiresAt === 'string' ? raw.expiresAt : null,
  }
}

/**
 * Whether a link has to be minted before this invitation can be sent.
 *
 * True for a request staged before the dialog minted one, and for the pathological
 * draft left open past the link's ninety-day life. Deliberately *not* part of
 * `validateConsultRequest`: a provider cannot mint a link by editing text, so
 * refusing the completion over it would strand them. The send path mints instead.
 */
export function needsLink(request: ConsultRequest, now: Date = new Date()): boolean {
  if (!request.bookingUrl) return true
  if (!request.expiresAt) return false

  const expires = Date.parse(request.expiresAt)
  return Number.isFinite(expires) && expires <= now.getTime()
}

/**
 * The paragraph appended to the patient's message telling them how to book.
 *
 * The provider's own words are left exactly as written and this is added after
 * them, because the URL is never in the box they typed into — it is minted by the
 * dialog and not shown to them, so it cannot be something they or the assistant
 * wrote.
 *
 * `url` is null everywhere the text is *recorded or previewed* rather than
 * delivered: the chart keeps a description because a single-use link would be dead
 * by the time anyone read the note, and the confirmation screen keeps one because
 * approving is still what sends it.
 */
export function patientBookingBlock(request: ConsultRequest, url: string | null): string {
  const eventType = eventTypeById(request.eventTypeId)
  const name = eventType ? eventType.name : 'a consultation'
  const duration = eventType ? ` (${eventType.duration} minutes)` : ''

  return [
    `To book your ${name}${duration}, use this link: ${url ?? '[single-use booking link]'}`,
    'The link is just for you and works once, so it stops working after you book.',
  ].join('\n\n')
}

/**
 * Whether this request can be acted on, without reference to the patient.
 *
 * Only the event type is checkable here. Whether the patient has an email address
 * to send it to is asked on the server, against the chart, by `consultProblems`.
 */
export function validateConsultRequest(request: ConsultRequest | null): string[] {
  if (!request) return []

  return eventTypeById(request.eventTypeId)
    ? []
    : ['That consultation type is no longer offered. Choose another.']
}

/**
 * One line describing the invitation: what is being booked, for how long, and with
 * whom when it names somebody.
 *
 * Read by the flyout's panel, the confirmation summary, the chart note and the
 * context handed to the AI assistant, for the same reason `orderLine` is: four
 * copies of this sentence would eventually disagree, and what disagreed would be
 * an appointment the provider was shown but the patient was never offered.
 *
 * Takes only the event type, so it also describes a request already resolved for
 * the record, whose message has been normalised to null.
 */
export function consultLine(request: Pick<ConsultRequest, 'eventTypeId'>): string {
  const eventType = eventTypeById(request.eventTypeId)
  if (!eventType) return 'A consultation type that is no longer offered'

  return [
    eventType.name,
    `${eventType.duration} minutes`,
    eventType.namedProvider ?? null,
  ]
    .filter(Boolean)
    .join(' · ')
}
