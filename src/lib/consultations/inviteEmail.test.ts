import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { INVITE_SUBJECT, consultationInvite } from './inviteEmail.ts'

const base = {
  firstName: 'Sam',
  bookingUrl: 'https://calendly.com/d/abc?email=sam%40example.com',
  eventTypeName: 'AlphaMD Provider, Secondary Follow-Up',
}

describe('consultationInvite', () => {
  it('keeps the main app’s subject line', () => {
    assert.equal(consultationInvite(base).subject, INVITE_SUBJECT)
  })

  it('always includes a plain-text part carrying the link', () => {
    const { text } = consultationInvite(base)
    assert.match(text, /Dear Sam,/)
    assert.ok(text.includes(base.bookingUrl))
  })

  it('greets a patient with no name on file the way the HTML letter does', () => {
    const { text } = consultationInvite({ ...base, firstName: null })
    assert.match(text, /^Dear Valued Patient,/)
    assert.doesNotMatch(text, /Dear ,/)
  })

  it('uses the same opening as the admin app’s letter', () => {
    assert.match(consultationInvite(base).text, /health journey/)
    assert.match(consultationInvite(base).text, /Schedule here:/)
  })

  it('names the consultation type, which is what the patient is booking', () => {
    assert.match(consultationInvite(base).text, /Secondary Follow-Up/)
  })

  it('says the link only works once', () => {
    assert.match(consultationInvite(base).text, /single-use link/)
    assert.match(consultationInvite(base).text, /only be used once/)
  })
})
