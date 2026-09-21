import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isAged,
  isOpen,
  questionRowMeta,
  type ProviderQuestionRow,
} from './queueRow.ts'

// 2026-09-24 is a Thursday.
const NOW = new Date('2026-09-24T15:00:00Z')

const row = (patch: Partial<ProviderQuestionRow> = {}): ProviderQuestionRow => ({
  id: 'q1',
  patientId: 'p1',
  patientName: 'Austin Ross',
  patientEmail: 'austin@example.com',
  patientStatus: 'Patient, Active Subscription',
  prescribingProviderName: null,
  status: 'queued',
  question: 'Can I move my injection day?',
  csComments: null,
  urgent: false,
  assignedTo: null,
  assignedToName: null,
  zendeskTicketId: null,
  createdAt: '2026-09-23T11:00:00Z',
  startedAt: null,
  finishedAt: null,
  finishedByName: null,
  resolution: null,
  openCountForPatient: 1,
  flags: [],
  ...patch,
})

test('queued and in progress are Open; finished is not', () => {
  assert.equal(isOpen(row()), true)
  assert.equal(isOpen(row({ status: 'in_progress' })), true)
  assert.equal(isOpen(row({ status: 'finished' })), false)
})

test('Aged is more than two weekdays since create, on an Open row only', () => {
  // Monday create → Thursday now: three weekdays.
  assert.equal(isAged(row({ createdAt: '2026-09-21T09:00:00Z' }), NOW), true)
  // Tuesday create → Thursday now: two weekdays, not yet.
  assert.equal(isAged(row({ createdAt: '2026-09-22T09:00:00Z' }), NOW), false)
  // In progress still ages; Finished never does.
  assert.equal(
    isAged(row({ createdAt: '2026-09-21T09:00:00Z', status: 'in_progress' }), NOW),
    true
  )
  assert.equal(
    isAged(row({ createdAt: '2026-09-21T09:00:00Z', status: 'finished' }), NOW),
    false
  )
})

test('Aged skips the weekend: a Friday question is not Aged the next Tuesday but is on Wednesday', () => {
  const fri = row({ createdAt: '2026-09-18T20:00:00Z' })
  assert.equal(isAged(fri, new Date('2026-09-22T09:00:00Z')), false)
  assert.equal(isAged(fri, new Date('2026-09-23T09:00:00Z')), true)
})

test('the meta line of a queued question says when it was asked and that it is queued', () => {
  assert.deepEqual(questionRowMeta(row(), NOW), ['asked 1d ago (09/23/26)', 'queued'])
})

test('the meta line of an in-progress question names the Question Assignee', () => {
  assert.deepEqual(
    questionRowMeta(
      row({
        status: 'in_progress',
        assignedTo: 'u2',
        assignedToName: 'Jonathan Meyer',
        startedAt: '2026-09-24T12:00:00Z',
      }),
      NOW
    ),
    ['asked 1d ago (09/23/26)', 'Jonathan Meyer has it', 'taken 3h ago']
  )
})

test('the meta line shows the prescribing provider apart from who has the question', () => {
  assert.deepEqual(
    questionRowMeta(
      row({
        prescribingProviderName: 'Dr Patel',
        status: 'in_progress',
        assignedTo: 'u2',
        assignedToName: 'Jonathan Meyer',
        startedAt: '2026-09-24T12:00:00Z',
      }),
      NOW
    ),
    [
      'asked 1d ago (09/23/26)',
      'prescribing: Dr Patel',
      'Jonathan Meyer has it',
      'taken 3h ago',
    ]
  )
})

test('the meta line of a finished question names who finished it and when', () => {
  assert.deepEqual(
    questionRowMeta(
      row({
        status: 'finished',
        assignedToName: 'Jonathan Meyer',
        finishedByName: 'Jonathan Meyer',
        finishedAt: '2026-09-24T10:00:00Z',
      }),
      NOW
    ),
    ['asked 1d ago (09/23/26)', 'finished by Jonathan Meyer 5h ago']
  )
})

test('a patient with more than one Open Provider Question gets a note on the row', () => {
  assert.deepEqual(questionRowMeta(row({ openCountForPatient: 3 }), NOW), [
    'asked 1d ago (09/23/26)',
    'queued',
    '3 open for this patient',
  ])
  assert.deepEqual(questionRowMeta(row({ openCountForPatient: 1 }), NOW), [
    'asked 1d ago (09/23/26)',
    'queued',
  ])
})
