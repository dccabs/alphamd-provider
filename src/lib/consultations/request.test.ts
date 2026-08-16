import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  consultLine,
  needsLink,
  parseConsultRequest,
  patientBookingBlock,
  validateConsultRequest,
  type ConsultRequest,
} from './request.ts'

/** An event type that really is in the catalogue. */
const FOLLOW_UP = '2d7a15dd-4c53-479b-b8ff-d26c508f4995'
/** One named after a clinician, for the third segment of the line. */
const TRACE = 'f2d57860-5ffa-4439-b0c3-a5505fd60bb2'

const BOOKING_URL = 'https://calendly.com/d/abc-def-ghi?email=adam%40example.com'

const request = (patch: Partial<ConsultRequest> = {}): ConsultRequest => ({
  eventTypeId: FOLLOW_UP,
  message: '',
  bookingUrl: BOOKING_URL,
  expiresAt: null,
  ...patch,
})

describe('parseConsultRequest', () => {
  it('reads back what the dialog wrote', () => {
    assert.deepEqual(
      parseConsultRequest({
        eventTypeId: FOLLOW_UP,
        message: 'Want to talk through ferritin.',
        bookingUrl: BOOKING_URL,
        expiresAt: '2026-11-14T00:00:00Z',
      }),
      {
        eventTypeId: FOLLOW_UP,
        message: 'Want to talk through ferritin.',
        bookingUrl: BOOKING_URL,
        expiresAt: '2026-11-14T00:00:00Z',
      }
    )
  })

  it('reads a request staged before links were minted early', () => {
    // Live in a draft when the dialog started minting. The send path mints for it
    // rather than refusing, so it must survive the read.
    assert.deepEqual(parseConsultRequest({ eventTypeId: FOLLOW_UP, message: 'Book in.' }), {
      eventTypeId: FOLLOW_UP,
      message: 'Book in.',
      bookingUrl: '',
      expiresAt: null,
    })
  })

  it('is null when nothing was staged', () => {
    for (const value of [null, undefined, '', 0, [], {}]) {
      assert.equal(parseConsultRequest(value), null)
    }
  })

  it('is null without an event type, because that is the whole decision', () => {
    assert.equal(parseConsultRequest({ message: 'Please book in.' }), null)
    assert.equal(parseConsultRequest({ eventTypeId: '   ', message: '' }), null)
  })

  it('defaults a missing or non-string message to empty rather than failing', () => {
    assert.equal(parseConsultRequest({ eventTypeId: FOLLOW_UP })?.message, '')
    assert.equal(parseConsultRequest({ eventTypeId: FOLLOW_UP, message: 42 })?.message, '')
  })

  it('ignores a booking link that is not a string', () => {
    assert.equal(parseConsultRequest({ eventTypeId: FOLLOW_UP, bookingUrl: 42 })?.bookingUrl, '')
    assert.equal(
      parseConsultRequest({ eventTypeId: FOLLOW_UP, bookingUrl: BOOKING_URL, expiresAt: 42 })
        ?.expiresAt,
      null
    )
  })

  it('keeps an event type that is no longer offered, for validation to name', () => {
    const parsed = parseConsultRequest({ eventTypeId: 'retired-event-type', message: '' })
    assert.equal(parsed?.eventTypeId, 'retired-event-type')
    assert.equal(validateConsultRequest(parsed).length, 1)
  })
})

describe('needsLink', () => {
  it('is false for a link the dialog just minted', () => {
    assert.equal(needsLink(request()), false)
  })

  it('is true when no link was ever minted', () => {
    assert.equal(needsLink(request({ bookingUrl: '' })), true)
  })

  it('is true once Calendly says the link has expired', () => {
    const now = new Date('2026-08-16T12:00:00Z')
    assert.equal(needsLink(request({ expiresAt: '2026-08-15T12:00:00Z' }), now), true)
    assert.equal(needsLink(request({ expiresAt: '2026-11-14T00:00:00Z' }), now), false)
  })

  it('trusts a link Calendly gave no expiry for rather than re-minting every time', () => {
    assert.equal(needsLink(request({ expiresAt: null })), false)
    assert.equal(needsLink(request({ expiresAt: 'not a date' })), false)
  })
})

describe('patientBookingBlock', () => {
  it('carries the real link in what the patient is sent', () => {
    const block = patientBookingBlock(request(), BOOKING_URL)
    assert.match(block, /To book your AlphaMD Provider, Secondary Follow-Up \(15 minutes\)/)
    assert.ok(block.includes(BOOKING_URL))
    assert.match(block, /works once/)
  })

  it('masks the link where the text is only recorded or previewed', () => {
    // A single-use link would be dead by the time anyone read the chart, and
    // approving is still what sends it.
    const block = patientBookingBlock(request(), null)
    assert.ok(!block.includes(BOOKING_URL))
    assert.match(block, /\[single-use booking link\]/)
    // Otherwise word for word what the patient will read, so the preview is honest.
    assert.equal(
      block.replace('[single-use booking link]', BOOKING_URL),
      patientBookingBlock(request(), BOOKING_URL)
    )
  })

  it('still reads as a sentence when the event type is retired', () => {
    const block = patientBookingBlock(request({ eventTypeId: 'gone' }), BOOKING_URL)
    assert.match(block, /To book your a consultation, use this link/)
  })
})

describe('validateConsultRequest', () => {
  it('accepts a type in the catalogue', () => {
    assert.deepEqual(validateConsultRequest(request()), [])
  })

  it('says nothing when no consultation was staged', () => {
    assert.deepEqual(validateConsultRequest(null), [])
  })

  it('refuses a retired type instead of inviting the patient to nothing', () => {
    const problems = validateConsultRequest(request({ eventTypeId: 'not-a-uuid' }))
    assert.equal(problems.length, 1)
    assert.match(problems[0], /no longer offered/)
  })

  it('does not refuse a request whose link has yet to be minted', () => {
    // The provider cannot fix that by editing anything, so it is the send path's
    // job, not something to block the completion on.
    assert.deepEqual(validateConsultRequest(request({ bookingUrl: '' })), [])
  })
})

describe('consultLine', () => {
  it('names the appointment and its length', () => {
    assert.equal(
      consultLine({ eventTypeId: FOLLOW_UP }),
      'AlphaMD Provider, Secondary Follow-Up · 15 minutes'
    )
  })

  it('names the clinician when the type is theirs', () => {
    assert.equal(
      consultLine({ eventTypeId: TRACE }),
      'Trace Owens, Secondary Follow-Up · 15 minutes · Trace Owens'
    )
  })

  it('describes a request already resolved for the record, whose message is null', () => {
    // What `planCompletion` puts in `detail`, read straight back by the summary.
    const recorded = {
      eventTypeId: FOLLOW_UP,
      eventTypeName: 'AlphaMD Provider, Secondary Follow-Up',
      message: null,
    }
    assert.equal(consultLine(recorded), 'AlphaMD Provider, Secondary Follow-Up · 15 minutes')
  })

  it('reads as a problem rather than a blank when the type is retired', () => {
    assert.match(consultLine({ eventTypeId: 'gone' }), /no longer offered/)
  })
})
