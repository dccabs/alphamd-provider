import assert from 'node:assert/strict'
import test from 'node:test'

import { FLAG_NOTE_SEPARATOR, mergeFlagNote, renderFlagNoteSection } from './flagNotes.ts'

const section = (body: string, ref = '1a2b3c4d') => ({
  ref,
  heading: 'Lab review by Dr Smith, Sep 24',
  body,
})

test('a flag with no note takes the section as its whole note', () => {
  assert.equal(
    mergeFlagNote(null, section('Ask the patient to upload a compliant lab report.')),
    'Lab review by Dr Smith, Sep 24 (ref 1a2b3c4d)\nAsk the patient to upload a compliant lab report.'
  )
  assert.equal(mergeFlagNote('   ', section('x')), renderFlagNoteSection(section('x')))
})

test('a note another writer left stays, and the review is added below it', () => {
  const existing = 'Order issue reported: box arrived damaged (Zendesk #123)'
  const merged = mergeFlagNote(existing, section('Ask about injection timing.'))

  assert.deepEqual(merged.split(FLAG_NOTE_SEPARATOR), [
    existing,
    'Lab review by Dr Smith, Sep 24 (ref 1a2b3c4d)\nAsk about injection timing.',
  ])
})

test('finalizing the same review again replaces its section instead of repeating it', () => {
  const first = mergeFlagNote('Order issue reported: late', section('Ask about timing.'))
  const again = mergeFlagNote(first, section('Ask about injection timing and the draw date.'))

  const parts = again.split(FLAG_NOTE_SEPARATOR)
  assert.equal(parts.length, 2)
  assert.equal(parts[0], 'Order issue reported: late')
  assert.match(parts[1], /injection timing and the draw date/)
})

test('two different reviews each keep their own section', () => {
  const first = mergeFlagNote(null, section('First ask.', 'aaaaaaaa'))
  const both = mergeFlagNote(first, section('Second ask.', 'bbbbbbbb'))
  assert.equal(both.split(FLAG_NOTE_SEPARATOR).length, 2)
})

test('a body with blank lines survives a later merge intact', () => {
  const first = mergeFlagNote(null, section('Line one.\n\nLine two.'))
  const again = mergeFlagNote(first, section('Line one.\n\nLine two.'))
  assert.equal(again, first)
})
