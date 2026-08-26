import assert from 'node:assert/strict'
import test from 'node:test'

import type { QueueRow } from './queries.ts'
import { progressOf, queueRowMeta, sourceLabel } from './queueRow.ts'

const NOW = new Date('2026-08-14T12:00:00Z')

const row = (patch: Partial<QueueRow> = {}): QueueRow => ({
  id: 'r1',
  patientId: 'p1',
  patientName: 'Austin Ross',
  patientEmail: 'austin@example.com',
  status: 'active',
  patientStatus: 'Patient, Active Subscription',
  summaryStatus: 'ready',
  assignedTo: null,
  assignedToName: null,
  startedAt: null,
  draftUpdatedAt: null,
  reviewedAt: null,
  lastSourceAt: '2026-08-12T12:00:00Z',
  createdAt: '2026-08-12T11:00:00Z',
  sourceKinds: ['incoming_fax'],
  flags: [],
  ...patch,
})

test('an untouched review is unclaimed', () => {
  assert.equal(progressOf(row()), 'unclaimed')
})

test('a started review is in progress', () => {
  assert.equal(progressOf(row({ startedAt: '2026-08-14T09:00:00Z' })), 'in_progress')
})

test('a finished review is not in progress, even though it was started', () => {
  // `started_at` is never cleared, so the status has to win here.
  assert.equal(
    progressOf(row({ status: 'finished', startedAt: '2026-08-13T09:00:00Z' })),
    'finished'
  )
})

test('an assigned review that nobody opened is not called in progress', () => {
  assert.equal(progressOf(row({ assignedTo: 'u2', assignedToName: 'Dr Smith' })), 'unclaimed')
})

test('a needs-attention review is still in progress', () => {
  assert.equal(
    progressOf(row({ status: 'needs_attention', startedAt: '2026-08-14T09:00:00Z' })),
    'in_progress'
  )
})

test('the meta line of an unclaimed review says how it arrived and that nobody has it', () => {
  assert.deepEqual(queueRowMeta(row(), NOW), ['Fax', 'arrived 2d ago (08/12/26)', 'unclaimed'])
})

test('the meta line of a review in progress names the assignee and the last edit', () => {
  assert.deepEqual(
    queueRowMeta(
      row({
        assignedToName: 'Jonathan Meyer',
        startedAt: '2026-08-14T08:00:00Z',
        draftUpdatedAt: '2026-08-14T09:00:00Z',
      }),
      NOW
    ),
    ['Fax', 'arrived 2d ago (08/12/26)', 'assigned to Jonathan Meyer', 'edited 3h ago']
  )
})

test('a review opened but not written in reports when it was started', () => {
  assert.deepEqual(
    queueRowMeta(
      row({ assignedToName: 'Jonathan Meyer', startedAt: '2026-08-14T08:00:00Z' }),
      NOW
    ),
    ['Fax', 'arrived 2d ago (08/12/26)', 'assigned to Jonathan Meyer', 'started 4h ago']
  )
})

test('a finished review names who finished it', () => {
  // `assigned_to` is stamped with the provider who closed the review, so the
  // name already on the row is the finisher, not a current holder.
  const meta = queueRowMeta(
    row({
      status: 'finished',
      assignedToName: 'Jonathan Meyer',
      startedAt: '2026-08-13T08:00:00Z',
      draftUpdatedAt: '2026-08-13T09:00:00Z',
      reviewedAt: '2026-08-13T10:00:00Z',
    }),
    NOW
  )
  assert.deepEqual(meta, [
    'Fax',
    'arrived 2d ago (08/12/26)',
    'finished by Jonathan Meyer 1d ago',
  ])
})

test('a finished review without a recorded finisher still says when', () => {
  const meta = queueRowMeta(
    row({
      status: 'finished',
      reviewedAt: '2026-08-13T10:00:00Z',
    }),
    NOW
  )
  assert.deepEqual(meta, ['Fax', 'arrived 2d ago (08/12/26)', 'finished 1d ago'])
})

test('the meta line drops what is missing rather than rendering a dash', () => {
  assert.deepEqual(
    queueRowMeta(row({ sourceKinds: [], lastSourceAt: null, createdAt: null }), NOW),
    ['unclaimed']
  )
})

test('sources read as the words the queue used before', () => {
  assert.equal(sourceLabel(['incoming_fax', 'patient_upload']), 'Fax + Upload')
  assert.equal(sourceLabel(['something_new']), 'something_new')
  assert.equal(sourceLabel([]), null)
})
