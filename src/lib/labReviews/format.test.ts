import assert from 'node:assert/strict'
import test from 'node:test'

import {
  initials,
  relativeAge,
  shortDate,
  shortDateTime,
  shortTime,
  statusTone,
} from './format.ts'

test('shortDate renders UTC, zero-padded, 2-digit year', () => {
  assert.equal(shortDate('2026-08-05T07:42:00Z'), '08/05/26')
  assert.equal(shortDate('2026-01-02T00:00:00Z'), '01/02/26')
})

test('shortDate does not shift the day for a late-UTC timestamp', () => {
  // 23:30 UTC would be the previous day in US timezones; UTC keeps it stable.
  assert.equal(shortDate('2026-08-05T23:30:00Z'), '08/05/26')
})

test('shortDateTime appends UTC time', () => {
  assert.equal(shortDateTime('2026-08-05T09:04:00Z'), '08/05/26 09:04')
})

test('shortTime drops the date but keeps UTC', () => {
  assert.equal(shortTime('2026-08-05T09:04:00Z'), '09:04')
  assert.equal(shortTime('2026-08-05T23:30:00Z'), '23:30')
})

test('invalid and missing dates render an em dash, never "Invalid Date"', () => {
  assert.equal(shortDate(null), '—')
  assert.equal(shortDate(undefined), '—')
  assert.equal(shortDate(''), '—')
  assert.equal(shortDate('not a date'), '—')
  assert.equal(shortDateTime('not a date'), '—')
  assert.equal(shortTime('not a date'), '—')
  assert.equal(shortTime(null), '—')
})

const NOW = new Date('2026-08-08T12:00:00Z')

test('relativeAge buckets', () => {
  assert.equal(relativeAge('2026-08-08T11:59:30Z', NOW), 'just now')
  assert.equal(relativeAge('2026-08-08T11:30:00Z', NOW), '30m ago')
  assert.equal(relativeAge('2026-08-08T09:00:00Z', NOW), '3h ago')
  assert.equal(relativeAge('2026-08-06T12:00:00Z', NOW), '2d ago')
  assert.equal(relativeAge('2026-06-08T12:00:00Z', NOW), '2mo ago')
  assert.equal(relativeAge('2024-08-08T12:00:00Z', NOW), '2y ago')
})

test('a future timestamp does not render a negative age', () => {
  assert.equal(relativeAge('2026-08-09T12:00:00Z', NOW), 'just now')
})

test('relativeAge on a missing value is empty, so it can be joined away', () => {
  assert.equal(relativeAge(null, NOW), '')
})

test('statusTone: only real patient statuses read as active', () => {
  // The five statuses actually present on queued lab reviews today.
  assert.equal(statusTone('Patient, Active Subscription'), 'active')
  assert.equal(statusTone('Non-Patient - Pricing sent to PT'), 'neutral')
  assert.equal(statusTone('Non-Patient - Test Results sent to provider for review'), 'neutral')
  assert.equal(statusTone('Non-Patient - Ready To Order'), 'neutral')
  assert.equal(statusTone('Non-Patient, Attended Initial Consultation (ordered a test)'), 'neutral')
})

test('statusTone: a cancelled subscription is not active either', () => {
  assert.equal(statusTone('Patient,  Subscription Cancelled'), 'neutral')
  assert.equal(statusTone('Non-Patient - Dropped'), 'neutral')
  assert.equal(statusTone(null), 'neutral')
  assert.equal(statusTone(''), 'neutral')
})

test('initials', () => {
  assert.equal(initials('Jonathan Meyer'), 'JM')
  assert.equal(initials('Cher'), 'C')
  assert.equal(initials('  mary jane  watson '), 'MW')
  assert.equal(initials(''), '?')
  assert.equal(initials(null), '?')
})
