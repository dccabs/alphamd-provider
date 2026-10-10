import assert from 'node:assert/strict'
import test from 'node:test'

import { latestPerDocument, parseFlags, splitByTab } from './lists.ts'

test('only the newest review of each document counts', () => {
  const rows = [
    { id: 'old', sanityDocumentId: 'doc-1', createdAt: '2026-10-01T00:00:00Z' },
    { id: 'other', sanityDocumentId: 'doc-2', createdAt: '2026-10-02T00:00:00Z' },
    { id: 'new', sanityDocumentId: 'doc-1', createdAt: '2026-10-05T00:00:00Z' },
  ]
  assert.deepEqual(
    latestPerDocument(rows).map((r) => r.id).sort(),
    ['new', 'other']
  )
})

type Row = Parameters<typeof splitByTab>[0][number] & { id: string }

function row(id: string, over: Partial<Row>): Row {
  return {
    id,
    standing: 'queued',
    priority: 100,
    createdAt: '2026-10-01T00:00:00Z',
    reviewedAt: null,
    approvedAt: null,
    ...over,
  }
}

test('the queue is sorted by priority, then oldest first, and includes stale and revised pages', () => {
  const { queue, changesRequested, approved } = splitByTab([
    row('later', { priority: 300 }),
    row('stale', { standing: 'stale', priority: 200 }),
    row('first', { priority: 100, createdAt: '2026-10-02T00:00:00Z' }),
    row('first-older', { priority: 100, createdAt: '2026-09-30T00:00:00Z' }),
    row('revised', { standing: 'revised', priority: 250 }),
    row('mine', { standing: 'in_review', priority: 150 }),
    row('waiting', { standing: 'changes_requested', reviewedAt: '2026-10-03T00:00:00Z' }),
    row('done-old', { standing: 'approved', approvedAt: '2026-10-01T00:00:00Z' }),
    row('done-new', { standing: 'approved', approvedAt: '2026-10-04T00:00:00Z' }),
  ])

  assert.deepEqual(
    queue.map((r) => r.id),
    ['first-older', 'first', 'mine', 'stale', 'revised', 'later']
  )
  assert.deepEqual(changesRequested.map((r) => r.id), ['waiting'])
  assert.deepEqual(approved.map((r) => r.id), ['done-new', 'done-old'])
})

test('batch flags keep only well-formed entries', () => {
  assert.deepEqual(
    parseFlags([
      { label: 'Hematocrit', detail: 'Hct 55% called fine', severity: 'high', url: 'https://x' },
      { label: 'Fold note' },
      { detail: 'no label' },
      'junk',
      null,
    ]),
    [
      { label: 'Hematocrit', detail: 'Hct 55% called fine', severity: 'high', url: 'https://x' },
      { label: 'Fold note', detail: null, severity: null, url: null },
    ]
  )
  assert.deepEqual(parseFlags({ not: 'an array' }), [])
})
