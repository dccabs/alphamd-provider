import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DICTATION_SESSION,
  NO_SPEECH,
  applyRealtimeEvent,
  isFinalTranscript,
  realtimeError,
  spokenText,
  transcriptAt,
} from './dictation.ts'

const delta = (text: string) => ({
  type: 'conversation.item.input_audio_transcription.delta',
  item_id: 'item_1',
  delta: text,
})

const completed = (transcript: string) => ({
  type: 'conversation.item.input_audio_transcription.completed',
  item_id: 'item_1',
  transcript,
})

/** Everything up to and including `events`, folded in order. */
const heard = (...events: unknown[]) => events.reduce(applyRealtimeEvent, NO_SPEECH)

test('the session asks for no turn detection, which this model refuses to do', () => {
  // Not a preference. `gpt-live-transcribe` rejects the session outright, which
  // is why stopping has to commit the buffer by hand.
  assert.equal(DICTATION_SESSION.audio.input.turn_detection, null)
  assert.equal(DICTATION_SESSION.type, 'transcription')
})

test('deltas accumulate as they arrive', () => {
  const state = heard(delta('Total '), delta('testosterone '), delta('is low.'))
  assert.equal(spokenText(state), 'Total testosterone is low.')
})

test('the final transcript replaces the guesses it corrects', () => {
  // The model heard "hemato crit" while listening and fixed it at the end. What
  // the provider keeps is the correction, not both versions.
  const state = heard(delta('Hemato '), delta('crit is 52'), completed('Hematocrit is 52.'))
  assert.equal(spokenText(state), 'Hematocrit is 52.')
  assert.equal(state.partial, '')
})

test('a second turn follows the first with a single space', () => {
  const state = heard(
    delta('Raising the dose.'),
    completed('Raising the dose.'),
    delta('Repeat labs in eight weeks.')
  )
  assert.equal(spokenText(state), 'Raising the dose. Repeat labs in eight weeks.')
})

test('a final transcript with no speech in it discards the guess', () => {
  // Silence that the model briefly mistook for a word.
  const state = heard(delta('Mm'), completed('   '))
  assert.equal(spokenText(state), '')
})

test('an unrecognised event cannot change a word', () => {
  const state = heard(delta('Raising the dose.'))
  const after = applyRealtimeEvent(state, { type: 'input_audio_buffer.committed' })
  assert.deepEqual(after, state)
  assert.deepEqual(applyRealtimeEvent(state, null), state)
  assert.deepEqual(applyRealtimeEvent(state, 'nonsense'), state)
  assert.deepEqual(applyRealtimeEvent(state, { type: 42 }), state)
})

test('an empty delta is not an edit', () => {
  const state = heard(delta('Raising the dose.'))
  assert.deepEqual(applyRealtimeEvent(state, delta('')), state)
})

test('dictating into an empty field is just what was said', () => {
  assert.equal(transcriptAt('', '', heard(delta('Raising the dose.'))), 'Raising the dose.')
})

test('dictating after existing text does not run into it', () => {
  const state = heard(delta('Repeat in eight weeks.'))
  assert.equal(
    transcriptAt('Raising the dose.', '', state),
    'Raising the dose. Repeat in eight weeks.'
  )
})

test('dictating mid-sentence keeps a space on both sides', () => {
  const state = heard(delta('and the estradiol'))
  assert.equal(
    transcriptAt('Total testosterone', ' are both low.', state),
    'Total testosterone and the estradiol are both low.'
  )
})

test('the space the model puts in front of its first delta does not show', () => {
  // Live behaviour, not hypothetical: the first delta of a turn comes back as
  // " Total testosterone…", and the field would start with a gap.
  const state = heard(delta(' Total testosterone'), delta(' is low.'))
  assert.equal(transcriptAt('', '', state), 'Total testosterone is low.')
})

test('a delta that ends mid-sentence does not double the space before what follows', () => {
  const state = heard(delta('and the estradiol '))
  assert.equal(
    transcriptAt('Total testosterone ', ' are both low.', state),
    'Total testosterone and the estradiol are both low.'
  )
})

test('a space the provider already typed is not doubled', () => {
  const state = heard(delta('Raising the dose.'))
  assert.equal(transcriptAt('Plan: ', '', state), 'Plan: Raising the dose.')
})

test('a newline counts as a space', () => {
  const state = heard(delta('Raising the dose.'))
  assert.equal(transcriptAt('Assessment:\n', '', state), 'Assessment:\nRaising the dose.')
})

test('nothing said leaves the field exactly as it was', () => {
  assert.equal(transcriptAt('Raising', ' the dose.', NO_SPEECH), 'Raising the dose.')
})

test('only a completed transcript reads as the last word', () => {
  // What tells a stopping session it can let go of the microphone.
  assert.equal(isFinalTranscript(completed('Hematocrit is 52.')), true)
  assert.equal(isFinalTranscript(delta('Hematocrit')), false)
  assert.equal(isFinalTranscript({ type: 'input_audio_buffer.committed' }), false)
  assert.equal(isFinalTranscript(null), false)
})

test('an error event carries the API’s own words', () => {
  assert.equal(
    realtimeError({ type: 'error', error: { message: 'Audio content is too long.' } }),
    'Audio content is too long.'
  )
})

test('an error with nothing to say still says something', () => {
  assert.equal(realtimeError({ type: 'error' }), 'The transcriber stopped unexpectedly.')
})

test('anything that is not an error is not reported as one', () => {
  assert.equal(realtimeError(delta('Raising the dose.')), null)
  assert.equal(realtimeError(null), null)
})
