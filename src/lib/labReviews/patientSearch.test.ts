import assert from 'node:assert/strict'
import test from 'node:test'

import {
  searchPatients,
  suggestionSubtitle,
  type PatientSearchRow,
} from './patientSearch.ts'

const person = (patch: Partial<PatientSearchRow> = {}): PatientSearchRow => ({
  patientId: 'p1',
  firstName: 'Dan',
  lastName: 'Smith',
  email: 'dan@example.com',
  needsAttention: 0,
  active: 0,
  finished: 0,
  lastSourceAt: null,
  ...patch,
})

const ids = (query: string, people: PatientSearchRow[]) =>
  searchPatients(people, query).map((row) => row.patientId)

test('fewer than two characters returns no suggestions', () => {
  assert.deepEqual(ids('d', [person()]), [])
  assert.deepEqual(ids('  ', [person()]), [])
})

test('a first name, last name, or email token matches that person', () => {
  const dan = person()
  assert.deepEqual(ids('dan', [dan]), ['p1'])
  assert.deepEqual(ids('smith', [dan]), ['p1'])
  assert.deepEqual(ids('dan@', [dan]), ['p1'])
})

test('first and last together match even when typed in either order', () => {
  const dan = person()
  assert.deepEqual(ids('dan smith', [dan]), ['p1'])
  assert.deepEqual(ids('smith dan', [dan]), ['p1'])
})

test('every token must hit some field', () => {
  assert.deepEqual(ids('dan jones', [person()]), [])
})

test('matching is case-insensitive and ignores extra spaces', () => {
  assert.deepEqual(ids('  DAN   SMITH  ', [person()]), ['p1'])
})

test('needs attention ranks above active, then finished, then none', () => {
  assert.deepEqual(
    ids('nile', [
      person({ patientId: 'none', firstName: 'Ann', lastName: 'Nile' }),
      person({ patientId: 'finished', firstName: 'Finn', lastName: 'Nile', finished: 1 }),
      person({ patientId: 'active', firstName: 'Ada', lastName: 'Nile', active: 1 }),
      person({ patientId: 'hot', firstName: 'Ned', lastName: 'Nile', needsAttention: 1 }),
    ]),
    ['hot', 'active', 'finished', 'none']
  )
})

test('within a band the most recent lab activity comes first', () => {
  assert.deepEqual(
    ids('ross', [
      person({
        patientId: 'older',
        firstName: 'Ann',
        lastName: 'Ross',
        active: 1,
        lastSourceAt: '2026-01-01T00:00:00Z',
      }),
      person({
        patientId: 'newer',
        firstName: 'Bob',
        lastName: 'Ross',
        active: 1,
        lastSourceAt: '2026-08-01T00:00:00Z',
      }),
    ]),
    ['newer', 'older']
  )
})

test('people with no reviews sort by last name', () => {
  assert.deepEqual(
    ids('ann', [
      person({ patientId: 'smith', firstName: 'Ann', lastName: 'Smith', email: 'ann@x.com' }),
      person({ patientId: 'adams', firstName: 'Ann', lastName: 'Adams', email: 'ann@y.com' }),
    ]),
    ['adams', 'smith']
  )
})

test('at most ten people are returned', () => {
  const people = Array.from({ length: 11 }, (_, i) =>
    person({
      patientId: `p${i}`,
      firstName: 'Sam',
      lastName: `Person${String(i).padStart(2, '0')}`,
    })
  )
  assert.equal(searchPatients(people, 'sam').length, 10)
  assert.equal(searchPatients(people, 'sam')[0].patientId, 'p0')
  assert.equal(searchPatients(people, 'sam')[9].patientId, 'p9')
})

test('the subtitle lists hottest statuses and skips zeros', () => {
  assert.equal(suggestionSubtitle({ needsAttention: 0, active: 0, finished: 0 }), 'No lab reviews')
  assert.equal(
    suggestionSubtitle({ needsAttention: 1, active: 2, finished: 1 }),
    '1 needs attention · 2 active · 1 finished'
  )
  assert.equal(suggestionSubtitle({ needsAttention: 0, active: 2, finished: 0 }), '2 active')
})
