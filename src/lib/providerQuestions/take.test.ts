import assert from 'node:assert/strict'
import test from 'node:test'

import { planTake } from './take.ts'

const ME = 'provider-me'
const OTHER = 'provider-other'

test('a queued question can be taken: it becomes in progress with me as Question Assignee', () => {
  assert.deepEqual(planTake({ status: 'queued', assignedTo: null }, ME), {
    kind: 'take',
    from: null,
    toStatus: 'in_progress',
  })
})

test("another provider's in-progress question can be taken onto me", () => {
  assert.deepEqual(planTake({ status: 'in_progress', assignedTo: OTHER }, ME), {
    kind: 'take',
    from: OTHER,
    toStatus: 'in_progress',
  })
})

test('taking my own in-progress question is a no-op that succeeds', () => {
  assert.deepEqual(planTake({ status: 'in_progress', assignedTo: ME }, ME), {
    kind: 'already-mine',
  })
})

test('a finished question cannot be taken', () => {
  assert.deepEqual(planTake({ status: 'finished', assignedTo: OTHER }, ME), {
    kind: 'refuse',
    error: 'This Provider Question is already finished.',
  })
})
