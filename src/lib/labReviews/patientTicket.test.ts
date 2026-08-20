import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BASELINE_CS_GROUP_ID,
  LAB_REVIEW_TICKET_STATUS,
  LAB_REVIEW_TICKET_SUBJECT,
  planPatientTicket,
} from './patientTicket.ts'

test('an empty message is a skip, even with no email', () => {
  assert.deepEqual(
    planPatientTicket({ message: '  \n  ', email: null, requesterName: 'Dan Test' }),
    { kind: 'skip' }
  )
})

test('a message with no email is refused rather than sent to a dummy address', () => {
  const plan = planPatientTicket({
    message: 'Your labs look good.',
    email: '  ',
    requesterName: 'Dan Test',
  })
  assert.equal(plan.kind, 'refuse')
  if (plan.kind !== 'refuse') return
  assert.match(plan.error, /no email/i)
})

test('a message with an email is a send with the locked ticket fields', () => {
  const plan = planPatientTicket({
    message: '  Your hematocrit is up.  ',
    email: 'dan@example.com',
    requesterName: 'Dan Test Cabaniss',
  })
  assert.deepEqual(plan, {
    kind: 'send',
    subject: LAB_REVIEW_TICKET_SUBJECT,
    status: LAB_REVIEW_TICKET_STATUS,
    groupId: BASELINE_CS_GROUP_ID,
    body: 'Your hematocrit is up.',
    requesterName: 'Dan Test Cabaniss',
    requesterEmail: 'dan@example.com',
  })
})

test('a blank requester name falls back to the email, so Zendesk still has a name', () => {
  const plan = planPatientTicket({
    message: 'Hi.',
    email: 'dan@example.com',
    requesterName: '  ',
  })
  assert.equal(plan.kind, 'send')
  if (plan.kind !== 'send') return
  assert.equal(plan.requesterName, 'dan@example.com')
})

test('the subject is what the patient will see in email', () => {
  assert.equal(LAB_REVIEW_TICKET_SUBJECT, 'Your lab results have been reviewed')
})

test('a new ticket waits on the patient', () => {
  assert.equal(LAB_REVIEW_TICKET_STATUS, 'pending')
})
