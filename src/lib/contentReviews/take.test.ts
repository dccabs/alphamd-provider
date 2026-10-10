import assert from 'node:assert/strict'
import test from 'node:test'

import { planTake } from './take.ts'

const ME = 'reviewer-me'
const OTHER = 'reviewer-other'

test('a queued review is claimed: in review with me', () => {
  assert.deepEqual(planTake({ standing: 'queued', assignedTo: null }, ME), {
    kind: 'claim',
    from: null,
  })
})

test("another reviewer's in-review row can be taken over", () => {
  assert.deepEqual(planTake({ standing: 'in_review', assignedTo: OTHER }, ME), {
    kind: 'claim',
    from: OTHER,
  })
})

test('taking my own in-review row is a no-op that succeeds', () => {
  assert.deepEqual(planTake({ standing: 'in_review', assignedTo: ME }, ME), { kind: 'already-mine' })
})

test('a stale approval or a revised page opens a new review, keeping the old one as history', () => {
  assert.deepEqual(planTake({ standing: 'stale', assignedTo: OTHER }, ME), { kind: 'reopen' })
  assert.deepEqual(planTake({ standing: 'revised', assignedTo: OTHER }, ME), { kind: 'reopen' })
})

test('a current approval cannot be taken', () => {
  assert.equal(planTake({ standing: 'approved', assignedTo: OTHER }, ME).kind, 'refuse')
})

test('changes requested on the published version waits for the editor', () => {
  const plan = planTake({ standing: 'changes_requested', assignedTo: OTHER }, ME)
  assert.equal(plan.kind, 'refuse')
  assert.match(plan.kind === 'refuse' ? plan.error : '', /editor/)
})
