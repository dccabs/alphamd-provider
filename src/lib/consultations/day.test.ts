import assert from 'node:assert/strict'
import test from 'node:test'

import {
  consultationType,
  dayWindow,
  durationMinutes,
  formatDayHeading,
  localDayKey,
  onLocalDay,
  parseDayKey,
  shiftDayKey,
} from './day.ts'

test('parseDayKey accepts YYYY-MM-DD only', () => {
  assert.equal(parseDayKey('2026-09-23'), '2026-09-23')
  assert.equal(parseDayKey('2026-9-23'), null)
  assert.equal(parseDayKey('tomorrow'), null)
  assert.equal(parseDayKey(undefined), null)
  assert.equal(parseDayKey(''), null)
})

test('dayWindow for a day key spans the UTC day plus 14h either side', () => {
  const { from, to } = dayWindow('2026-09-23')
  assert.equal(from, '2026-09-22T10:00:00.000Z')
  assert.equal(to, '2026-09-24T14:00:00.000Z')
})

test('dayWindow with no key spans 36h either side of now', () => {
  const now = new Date('2026-09-21T18:00:00Z')
  const { from, to } = dayWindow(null, now)
  assert.equal(from, '2026-09-20T06:00:00.000Z')
  assert.equal(to, '2026-09-23T06:00:00.000Z')
})

test('shiftDayKey crosses month ends and stays local', () => {
  assert.equal(shiftDayKey('2026-09-30', 1), '2026-10-01')
  assert.equal(shiftDayKey('2026-03-01', -1), '2026-02-28')
  assert.equal(localDayKey(new Date(2026, 0, 5)), '2026-01-05')
})

test('onLocalDay keeps the rows on that local day, earliest first', () => {
  const day = localDayKey(new Date(2026, 8, 23, 12))
  const at = (h: number) => ({ startsAt: new Date(2026, 8, 23, h).toISOString() })
  const rows = [at(14), { startsAt: new Date(2026, 8, 24, 9).toISOString() }, at(9)]

  assert.deepEqual(onLocalDay(rows, day), [at(9), at(14)])
})

test('formatDayHeading names today and tomorrow', () => {
  assert.equal(formatDayHeading('2026-09-21', '2026-09-21'), 'Today')
  assert.equal(formatDayHeading('2026-09-22', '2026-09-21'), 'Tomorrow')
  assert.notEqual(formatDayHeading('2026-09-25', '2026-09-21'), 'Today')
})

test('consultationType takes the part after the comma', () => {
  assert.equal(consultationType('AlphaMD Provider, Secondary Follow-Up'), 'Secondary Follow-Up')
  assert.equal(consultationType('Lab Review Call'), 'Lab Review Call')
  assert.equal(consultationType(null), 'Consultation')
})

test('durationMinutes rounds and rejects nonsense', () => {
  assert.equal(durationMinutes('2026-09-23T14:00:00Z', '2026-09-23T14:30:00Z'), 30)
  assert.equal(durationMinutes('2026-09-23T14:00:00Z', null), null)
  assert.equal(durationMinutes('2026-09-23T14:00:00Z', '2026-09-23T13:00:00Z'), null)
})
