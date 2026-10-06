import assert from 'node:assert/strict'
import test from 'node:test'

import { parseQuestionRecap, questionRecapPrompt } from './questionRecap.ts'

test('the recap is trimmed and one paragraph', () => {
  assert.equal(
    parseQuestionRecap('  You asked whether you can\nmove your injection day.  '),
    'You asked whether you can move your injection day.'
  )
})

test('wrapping quotes are removed', () => {
  assert.equal(parseQuestionRecap('"You asked about your dose."'), 'You asked about your dose.')
  assert.equal(parseQuestionRecap('“You asked about your dose.”'), 'You asked about your dose.')
})

test('NONE means there is no patient question to recap', () => {
  assert.equal(parseQuestionRecap('NONE'), '')
  assert.equal(parseQuestionRecap(' none. '), '')
  assert.equal(parseQuestionRecap(''), '')
})

test('a runaway reply is refused rather than sent', () => {
  assert.equal(parseQuestionRecap(`You asked ${'a lot '.repeat(100)}`), '')
})

test('the prompt carries the question and nothing else from the record', () => {
  const prompt = questionRecapPrompt('  Can I move my shot to Thursday?  ')
  assert.ok(prompt.user.includes('Can I move my shot to Thursday?'))
  assert.match(prompt.system, /NONE/)
})
