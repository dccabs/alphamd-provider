import assert from 'node:assert/strict'
import test from 'node:test'

import {
  consultationOutcome,
  featuredConsultation,
  upcomingCount,
  type Consultation,
} from './consultations.ts'

const NOW = new Date('2026-08-13T12:00:00Z')
const PAST = '2026-05-21T16:45:00Z'
const FUTURE = '2026-08-18T16:30:00Z'

test('a past appointment left as active is not reported as attended', () => {
  assert.equal(consultationOutcome('active', PAST, NOW), 'unrecorded')
})

test('active means "not cancelled", so a future one is upcoming', () => {
  assert.equal(consultationOutcome('active', FUTURE, NOW), 'scheduled')
})

test('no-show wins over the date', () => {
  assert.equal(consultationOutcome('no-show', PAST, NOW), 'no_show')
  assert.equal(consultationOutcome('no_show', FUTURE, NOW), 'no_show')
})

test('both spellings of complete count as attended', () => {
  assert.equal(consultationOutcome('complete', PAST, NOW), 'attended')
  assert.equal(consultationOutcome('completed', PAST, NOW), 'attended')
})

test('both spellings of cancelled are honoured', () => {
  assert.equal(consultationOutcome('cancelled', FUTURE, NOW), 'cancelled')
  assert.equal(consultationOutcome('canceled', FUTURE, NOW), 'cancelled')
})

test('status is matched case- and whitespace-insensitively', () => {
  assert.equal(consultationOutcome('  No-Show  ', PAST, NOW), 'no_show')
})

test('an unknown status falls back to the date', () => {
  assert.equal(consultationOutcome('rescheduled', FUTURE, NOW), 'scheduled')
  assert.equal(consultationOutcome('rescheduled', PAST, NOW), 'unrecorded')
})

test('a missing or unparseable date is never called upcoming', () => {
  assert.equal(consultationOutcome('active', null, NOW), 'unrecorded')
  assert.equal(consultationOutcome('active', 'not a date', NOW), 'unrecorded')
})

const consultation = (
  outcome: Consultation['outcome'],
  startsAt: string | null = null
): Consultation => ({
  id: startsAt ?? String(Math.random()),
  startsAt,
  endsAt: null,
  name: null,
  providerName: null,
  timezone: null,
  outcome,
})

test('only scheduled consultations are counted as upcoming', () => {
  assert.equal(
    upcomingCount([
      consultation('scheduled'),
      consultation('scheduled'),
      consultation('unrecorded'),
      consultation('no_show'),
      consultation('cancelled'),
      consultation('attended'),
    ]),
    2
  )
})

test('no consultations', () => {
  assert.equal(upcomingCount([]), 0)
})

const LATER = '2026-09-30T15:00:00Z'
const RECENT_PAST = '2026-07-02T15:00:00Z'

test('a booking that has not happened yet outranks history', () => {
  const featured = featuredConsultation([
    consultation('scheduled', FUTURE),
    consultation('unrecorded', RECENT_PAST),
  ])
  assert.equal(featured?.startsAt, FUTURE)
})

test('the soonest upcoming wins, not the furthest out', () => {
  const featured = featuredConsultation([
    consultation('scheduled', LATER),
    consultation('scheduled', FUTURE),
  ])
  assert.equal(featured?.startsAt, FUTURE)
})

test('with nothing booked, the most recent appointment is chosen', () => {
  const featured = featuredConsultation([
    consultation('no_show', RECENT_PAST),
    consultation('unrecorded', PAST),
  ])
  assert.equal(featured?.startsAt, RECENT_PAST)
})

test('the answer does not depend on the order the rows arrive in', () => {
  const rows = [
    consultation('unrecorded', PAST),
    consultation('scheduled', LATER),
    consultation('scheduled', FUTURE),
    consultation('no_show', RECENT_PAST),
  ]
  assert.equal(featuredConsultation(rows)?.startsAt, FUTURE)
  assert.equal(featuredConsultation([...rows].reverse())?.startsAt, FUTURE)
})

test('a row with no usable date is only chosen as a last resort', () => {
  assert.equal(
    featuredConsultation([consultation('unrecorded'), consultation('unrecorded', PAST)])?.startsAt,
    PAST
  )
  assert.equal(featuredConsultation([consultation('unrecorded')])?.startsAt, null)
})

test('no consultations means nothing to feature', () => {
  assert.equal(featuredConsultation([]), null)
})
