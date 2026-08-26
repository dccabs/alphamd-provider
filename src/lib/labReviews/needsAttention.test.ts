import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EMPTY_ESCALATION,
  ESCALATION_TARGETS,
  ESCALATION_TARGET_HINTS,
  ESCALATION_TARGET_LABELS,
  isEscalationTarget,
  parseTargets,
  summarizeNeedsAttention,
  transfersOwnership,
  validateEscalation,
  type Escalation,
} from './needsAttention.ts'

const escalation = (patch: Partial<Escalation> = {}): Escalation => ({
  ...EMPTY_ESCALATION,
  ...patch,
})

test('the two targets are recognised and nothing else is', () => {
  assert.ok(isEscalationTarget('customer_service'))
  assert.ok(isEscalationTarget('provider'))
  assert.equal(isEscalationTarget('director'), false)
  assert.equal(isEscalationTarget(7), false)
  assert.equal(isEscalationTarget(undefined), false)
})

test('a target list from the browser is filtered and deduplicated', () => {
  assert.deepEqual(parseTargets(['provider', 'director', 'provider']), ['provider'])
  assert.deepEqual(parseTargets('provider'), [])
  assert.deepEqual(parseTargets(null), [])
})

test('a note is the only thing a park requires', () => {
  const problems = validateEscalation(escalation())
  assert.deepEqual(problems, ['Say why this needs attention.'])
})

test('a note with no targets parks the review without involving anyone', () => {
  assert.deepEqual(validateEscalation(escalation({ note: 'Come back after I check last month\'s Hct' })), [])
})

test('a note of whitespace is not a note', () => {
  const problems = validateEscalation(
    escalation({ targets: ['customer_service'], note: '   \n ' })
  )
  assert.deepEqual(problems, ['Say why this needs attention.'])
})

test('customer service alone is a complete escalation', () => {
  assert.deepEqual(
    validateEscalation(escalation({ targets: ['customer_service'], note: 'Book a redraw' })),
    []
  )
})

test('handing to a provider requires naming which one', () => {
  assert.deepEqual(
    validateEscalation(escalation({ targets: ['provider'], note: 'Out of my scope' })),
    ['Choose which provider to hand this to.']
  )

  assert.deepEqual(
    validateEscalation(
      escalation({ targets: ['provider'], note: 'Out of my scope', toProviderId: 'u1' })
    ),
    []
  )
})

test('both targets at once is allowed', () => {
  assert.deepEqual(
    validateEscalation(
      escalation({
        targets: ['customer_service', 'provider'],
        note: 'Needs a redraw and a second opinion',
        toProviderId: 'u1',
      })
    ),
    []
  )
})

test('parking for yourself does not transfer ownership', () => {
  assert.equal(transfersOwnership(escalation({ note: 'Come back later' })), false)
})

test('customer service does not take ownership of a review', () => {
  assert.equal(transfersOwnership(escalation({ targets: ['customer_service'] })), false)
})

test('a self-park is recorded as needing attention, not as an escalation', () => {
  assert.equal(
    summarizeNeedsAttention({ actorName: 'Dan', targets: [], handedToName: null }),
    'Dan marked this as needing attention'
  )
})

test('an escalation names who was involved', () => {
  assert.equal(
    summarizeNeedsAttention({
      actorName: 'Dan',
      targets: ['customer_service'],
      handedToName: null,
    }),
    'Dan escalated to Customer service'
  )
  assert.equal(
    summarizeNeedsAttention({
      actorName: 'Dan',
      targets: ['provider'],
      handedToName: 'Sam',
    }),
    'Dan escalated to Another provider, handing the review to Sam'
  )
})

test('the provider route does take ownership', () => {
  assert.ok(transfersOwnership(escalation({ targets: ['provider'] })))
  assert.ok(transfersOwnership(escalation({ targets: ['customer_service', 'provider'] })))
})

test('every target has a label and a hint', () => {
  for (const target of ESCALATION_TARGETS) {
    assert.ok(ESCALATION_TARGET_LABELS[target].length > 0)
    assert.ok(ESCALATION_TARGET_HINTS[target].length > 0)
  }
})
