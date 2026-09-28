import assert from 'node:assert/strict'
import test from 'node:test'

import { newTicketPayload } from './zendeskTicket.ts'

const base = {
  subject: 'Your lab results have been reviewed',
  htmlBody: '<p>Hi Jerry</p>',
  requester: { name: 'Jerry Arguello', email: 'jerry@example.com' },
  status: 'pending',
  groupId: 42,
}

test('the author submits the ticket and writes its first comment, not the requester', () => {
  const { ticket } = newTicketPayload({ ...base, authorId: 777 })

  assert.equal(ticket.submitter_id, 777)
  assert.equal(ticket.comment.author_id, 777)
  assert.deepEqual(ticket.requester, base.requester)
  assert.equal(ticket.comment.public, true)
})

test('with no known author the payload names none, leaving Zendesk to decide', () => {
  const { ticket } = newTicketPayload({ ...base, authorId: null })

  assert.equal('submitter_id' in ticket, false)
  assert.equal('author_id' in ticket.comment, false)
})
