import assert from 'node:assert/strict'
import test from 'node:test'

import { planDecision } from './decision.ts'

const ME = 'reviewer-me'
const REV = 'rev-shown'

const mine = { status: 'in_review' as const, assignedTo: ME }

function errorOf(plan: ReturnType<typeof planDecision>): string {
  return plan.ok ? '' : plan.error
}

test('approve records the _rev the reviewer was shown', () => {
  assert.deepEqual(
    planDecision({ row: mine, viewerId: ME, shownRev: REV, currentRev: REV, decision: 'approve' }),
    { ok: true, toStatus: 'approved', reviewedRev: REV, comment: null }
  )
})

test('approve keeps an optional comment, trimmed', () => {
  const plan = planDecision({
    row: mine,
    viewerId: ME,
    shownRev: REV,
    currentRev: REV,
    decision: 'approve',
    comment: '  Looks right.  ',
  })
  assert.equal(plan.ok && plan.comment, 'Looks right.')
})

test('request changes needs a comment', () => {
  const plan = planDecision({
    row: mine,
    viewerId: ME,
    shownRev: REV,
    currentRev: REV,
    decision: 'request_changes',
    comment: '   ',
  })
  assert.match(errorOf(plan), /what needs to change/i)
})

test('request changes records the comment and the _rev', () => {
  assert.deepEqual(
    planDecision({
      row: mine,
      viewerId: ME,
      shownRev: REV,
      currentRev: REV,
      decision: 'request_changes',
      comment: 'Hematocrit threshold is wrong.',
    }),
    {
      ok: true,
      toStatus: 'changes_requested',
      reviewedRev: REV,
      comment: 'Hematocrit threshold is wrong.',
    }
  )
})

test('a decision is refused when the page changed while it was being read', () => {
  const plan = planDecision({
    row: mine,
    viewerId: ME,
    shownRev: REV,
    currentRev: 'rev-newer',
    decision: 'approve',
  })
  assert.match(errorOf(plan), /changed in Sanity/)
})

test('a decision is refused when Sanity cannot confirm the published version', () => {
  const base = { row: mine, viewerId: ME, shownRev: REV, decision: 'approve' as const }
  assert.match(errorOf(planDecision({ ...base, currentRev: undefined })), /Sanity/)
  assert.match(errorOf(planDecision({ ...base, currentRev: null })), /not published/)
})

test('only the reviewer who has it may decide, and only while in review', () => {
  const base = { viewerId: ME, shownRev: REV, currentRev: REV, decision: 'approve' as const }
  assert.match(
    errorOf(planDecision({ ...base, row: { status: 'in_review', assignedTo: 'other' } })),
    /Take it/
  )
  assert.match(errorOf(planDecision({ ...base, row: { status: 'queued', assignedTo: null } })), /Take/)
  assert.match(
    errorOf(planDecision({ ...base, row: { status: 'approved', assignedTo: ME } })),
    /already/
  )
})
