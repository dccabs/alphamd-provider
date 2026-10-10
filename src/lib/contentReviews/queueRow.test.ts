import assert from 'node:assert/strict'
import test from 'node:test'

import { reviewRowMeta } from './queueRow.ts'

const base = {
  documentType: 'resources' as const,
  standing: 'queued' as const,
  assignedToName: null,
  startedAt: null,
  reviewedByName: null,
  reviewedAt: null,
  approvedAt: null,
}

test('a queued article says what it is and that it is waiting', () => {
  assert.deepEqual(reviewRowMeta(base), ['Article', 'queued'])
})

test('an in-review row names who has it', () => {
  assert.deepEqual(
    reviewRowMeta(
      { ...base, documentType: 'askUsAnything', standing: 'in_review', assignedToName: 'Saba Haq' }),
    ['Ask Us Anything', 'Saba Haq has it']
  )
})

test('a stale approval says who approved it and that the page changed', () => {
  assert.deepEqual(
    reviewRowMeta(
      {
        ...base,
        documentType: 'featuredTreatments',
        standing: 'stale',
        reviewedByName: 'Trace Owens',
        approvedAt: '2026-10-01T00:00:00Z',
      }),
    ['Treatment page', 'approved by Trace Owens (10/01/26)', 'page changed since']
  )
})

test('a revised page says changes were requested and the editor published again', () => {
  assert.deepEqual(
    reviewRowMeta(
      { ...base, standing: 'revised', reviewedByName: 'Trace Owens', reviewedAt: '2026-10-02T00:00:00Z' }),
    ['Article', 'changes requested by Trace Owens (10/02/26)', 'revised since']
  )
})
