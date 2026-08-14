import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { INVITE_SUBJECT, consultationInvite } from './inviteEmail.ts'

const base = {
  firstName: 'Sam',
  bookingUrl: 'https://calendly.com/d/abc?email=sam%40example.com',
  eventTypeName: 'AlphaMD Provider, Secondary Follow-Up',
  message: '',
}

describe('consultationInvite', () => {
  it('keeps the main app’s subject line', () => {
    assert.equal(consultationInvite(base).subject, INVITE_SUBJECT)
  })

  it('always includes a plain-text part carrying the link', () => {
    const { text } = consultationInvite(base)
    assert.match(text, /Hi Sam,/)
    assert.ok(text.includes(base.bookingUrl))
  })

  it('greets a patient with no name on file without an empty gap', () => {
    const { text, html } = consultationInvite({ ...base, firstName: null })
    assert.match(text, /^Hello,/)
    assert.doesNotMatch(html, /Hi ,/)
  })

  it('uses the provider’s own words when given, and a default when not', () => {
    assert.match(
      consultationInvite({ ...base, message: 'I want to talk through your ferritin.' }).text,
      /talk through your ferritin/
    )
    assert.match(consultationInvite(base).text, /go over your results/)
  })

  it('names the consultation type, which is what the patient is booking', () => {
    const { text, html } = consultationInvite(base)
    assert.match(text, /Secondary Follow-Up/)
    assert.match(html, /Secondary Follow-Up/)
  })

  it('says the link only works once', () => {
    assert.match(consultationInvite(base).text, /works once/)
    assert.match(consultationInvite(base).html, /works once/)
  })

  it('escapes a message so a stray angle bracket cannot break the email', () => {
    const { html } = consultationInvite({ ...base, message: 'Labs <5 & falling' })
    assert.match(html, /Labs &lt;5 &amp; falling/)
    assert.doesNotMatch(html, /Labs <5/)
  })

  it('escapes a name containing markup', () => {
    const { html } = consultationInvite({ ...base, firstName: '<b>Sam' })
    assert.match(html, /&lt;b&gt;Sam/)
  })

  it('keeps a multi-line message readable in HTML', () => {
    const { html } = consultationInvite({ ...base, message: 'One.\nTwo.' })
    assert.match(html, /One\.<br \/>Two\./)
  })

  it('escapes the booking url in the href without corrupting its query', () => {
    const { html } = consultationInvite({
      ...base,
      bookingUrl: 'https://calendly.com/d/abc?email=a%40b.com&name=Sam',
    })
    assert.match(html, /href="https:\/\/calendly\.com\/d\/abc\?email=a%40b\.com&amp;name=Sam"/)
  })
})
