import assert from 'node:assert/strict'
import test from 'node:test'

import { filterNotes, type Note } from './notes.ts'

const note = (id: number, tag: Note['tag']): Note => ({
  id,
  tag,
  author: 'A',
  createdAt: null,
  note: '',
  isOfficialVisit: false,
})

const NOTES: Note[] = [
  note(1, 'PROVIDER'),
  note(2, 'INTERNAL'),
  note(3, 'STAFF'),
  note(4, 'PATIENT'),
  note(5, 'SYSTEM'),
]

test('provider filter shows only provider-authored notes', () => {
  assert.deepEqual(filterNotes(NOTES, 'provider').map((n) => n.id), [1])
})

test('+ Internal adds internal-only notes to provider notes', () => {
  assert.deepEqual(filterNotes(NOTES, 'internal').map((n) => n.id), [1, 2])
})

test('all keeps staff, patient and system notes too', () => {
  assert.deepEqual(filterNotes(NOTES, 'all').map((n) => n.id), [1, 2, 3, 4, 5])
})

test('all is genuinely wider than internal — patients author notes', () => {
  assert.ok(filterNotes(NOTES, 'all').length > filterNotes(NOTES, 'internal').length)
})

test('empty input', () => {
  assert.deepEqual(filterNotes([], 'provider'), [])
})
