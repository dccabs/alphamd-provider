import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_REPLY_IDENTITY,
  REPLY_IDENTITIES,
  REPLY_IDENTITY_LABELS,
  isReplyIdentity,
} from './replyIdentity.ts'

test('the two identities are recognised', () => {
  assert.ok(isReplyIdentity('self'))
  assert.ok(isReplyIdentity('support'))
})

test('anything else is rejected, so a tampered form falls back', () => {
  assert.equal(isReplyIdentity('admin'), false)
  assert.equal(isReplyIdentity('Self'), false)
  assert.equal(isReplyIdentity(''), false)
  assert.equal(isReplyIdentity(undefined), false)
})

test('every identity has a label, so the composer cannot render blank', () => {
  for (const identity of REPLY_IDENTITIES) {
    assert.ok(REPLY_IDENTITY_LABELS[identity].length > 0)
  }
})

test('the default is a real identity', () => {
  assert.ok(isReplyIdentity(DEFAULT_REPLY_IDENTITY))
})
