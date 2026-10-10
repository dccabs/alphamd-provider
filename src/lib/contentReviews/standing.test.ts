import assert from 'node:assert/strict'
import test from 'node:test'

import { isApprovalCurrent, isInQueue, reviewStanding } from './standing.ts'

const REV_A = 'revA'
const REV_B = 'revB'

test('an approval holds while the published _rev is the one approved', () => {
  const row = { status: 'approved' as const, reviewedRev: REV_A }
  assert.equal(reviewStanding(row, REV_A), 'approved')
  assert.equal(isApprovalCurrent(row, REV_A), true)
})

test('an approval goes stale when the Sanity _rev changes', () => {
  const row = { status: 'approved' as const, reviewedRev: REV_A }
  assert.equal(reviewStanding(row, REV_B), 'stale')
  assert.equal(isApprovalCurrent(row, REV_B), false)
  assert.equal(isInQueue(reviewStanding(row, REV_B)), true)
})

test('an approval is not current when the document is unpublished or Sanity is unreachable', () => {
  const row = { status: 'approved' as const, reviewedRev: REV_A }
  assert.equal(isApprovalCurrent(row, null), false)
  assert.equal(isApprovalCurrent(row, undefined), false)
  // Unknown is not proof of a change, so the row stays where it was.
  assert.equal(reviewStanding(row, undefined), 'approved')
})

test('changes requested waits on the editor until a new revision is published', () => {
  const row = { status: 'changes_requested' as const, reviewedRev: REV_A }
  assert.equal(reviewStanding(row, REV_A), 'changes_requested')
  assert.equal(isInQueue('changes_requested'), false)

  assert.equal(reviewStanding(row, REV_B), 'revised')
  assert.equal(isInQueue('revised'), true)
})

test('open reviews keep their status whatever the _rev', () => {
  assert.equal(reviewStanding({ status: 'queued', reviewedRev: null }, REV_A), 'queued')
  assert.equal(reviewStanding({ status: 'in_review', reviewedRev: null }, REV_B), 'in_review')
  assert.equal(isInQueue('queued'), true)
  assert.equal(isInQueue('in_review'), true)
  assert.equal(isInQueue('approved'), false)
})

test('a queued or changes-requested row is never a current approval', () => {
  assert.equal(isApprovalCurrent({ status: 'queued', reviewedRev: null }, REV_A), false)
  assert.equal(isApprovalCurrent({ status: 'changes_requested', reviewedRev: REV_A }, REV_A), false)
})
