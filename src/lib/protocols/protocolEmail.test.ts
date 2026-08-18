import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DraftMedication } from '../labReviews/reviewDraft.ts'
import { ANCILLARIES, PRODUCTS, testCatalog } from './__fixtures__/catalog.ts'
import { pricingBreakdown } from './breakdown.ts'
import { planProtocol, type ProtocolQuote } from './protocolPlan.ts'
import { PROTOCOL_SUBJECT, protocolEmail } from './protocolEmail.ts'

/**
 * What the patient reads.
 *
 * Asserted on the figures and the section headings rather than the prose: the
 * headings are what a patient comparing this to their last email looks for, and
 * the figures are the part that gets charged to a card.
 */

const CATALOG = testCatalog()
const NOW = new Date('2026-08-17T15:00:00Z')

const med = (patch: Partial<DraftMedication> = {}): DraftMedication => ({
  medicationId: null,
  name: '',
  dose: '',
  sig: '',
  dosageMg: null,
  ...patch,
})

function quoteOf(medications: DraftMedication[]): ProtocolQuote {
  const plan = planProtocol(CATALOG, medications, NOW)
  assert.equal(plan.kind, 'quote')
  return plan.quote
}

const TESTOSTERONE = med({
  medicationId: PRODUCTS.cypionate.medicationId,
  name: 'Testosterone cypionate',
  dose: '160mg/week',
  sig: 'Inject .4mL subcutaneously every 3.5 days.',
  dosageMg: 160,
})

const HCG = med({
  medicationId: ANCILLARIES.hcg.medicationId,
  name: 'HCG',
  dose: '10,000 units',
})

const ANASTROZOLE = med({
  medicationId: ANCILLARIES.anastrozole.medicationId,
  name: 'Anastrozole',
  dose: '1.00mg - Take 1/2 tablet (0.50mg) by mouth twice weekly.',
})

test('the subject is the one patients have had before', () => {
  const email = protocolEmail({ firstName: 'Dan', quote: quoteOf([TESTOSTERONE]) })

  assert.equal(email.subject, PROTOCOL_SUBJECT)
  assert.match(email.subject, /^\[Action Required\]/)
})

test('the patient is greeted by first name, and by nothing when there is none', () => {
  const quote = quoteOf([TESTOSTERONE])

  assert.match(protocolEmail({ firstName: 'Dan', quote }).text, /^Hello Dan,/)
  assert.match(protocolEmail({ firstName: '  ', quote }).text, /^Hello,/)
  assert.match(protocolEmail({ firstName: null, quote }).text, /^Hello,/)
})

test('the sections appear in the order the previous email used them', () => {
  const { text } = protocolEmail({ firstName: 'Dan', quote: quoteOf([TESTOSTERONE]) })

  const headings = [
    'RECOMMENDED PROTOCOL:',
    'PRICING BREAKDOWN:',
    'PAYMENT TERMS:',
    'HOW IT WORKS:',
    'SEAMLESS SUPPLY:',
    'BANK STATEMENT:',
    'FIRST ORDER:',
  ]

  const positions = headings.map((heading) => {
    const at = text.indexOf(heading)
    assert.notEqual(at, -1, `${heading} is missing`)
    return at
  })

  assert.deepEqual(positions, [...positions].sort((a, b) => a - b))
})

test('each medication is listed with what to do with it', () => {
  const { text } = protocolEmail({ firstName: 'Dan', quote: quoteOf([TESTOSTERONE, HCG]) })

  assert.match(
    text,
    /• Testosterone cypionate: 160mg\/week — Inject \.4mL subcutaneously every 3\.5 days\./
  )
  assert.match(text, /• HCG: 10,000 units/)
})

test('the breakdown shows the price, the tax and the total', () => {
  assert.deepEqual(pricingBreakdown(quoteOf([TESTOSTERONE])), [
    'Testosterone Cypionate',
    'Dosage: 160mg',
    'Billing Period: Monthly',
    'Base Price: $129.00/mo',
    'Tax (6.5%): $8.39',
    'Subscription Total: $137.39',
  ])
})

test('a dose surcharge is shown as a line the patient can see', () => {
  const highDose = { ...TESTOSTERONE, dose: '250mg/week', dosageMg: 250 }
  const breakdown = pricingBreakdown(quoteOf([highDose]))

  assert.ok(breakdown.includes('Dosage Surcharge: +$18.75/mo'))
})

test('an ancillary that costs nothing says so rather than showing a zero', () => {
  const breakdown = pricingBreakdown(quoteOf([TESTOSTERONE, ANASTROZOLE]))

  assert.ok(breakdown.includes('Ancillary Medications (One-time):'))
  assert.ok(breakdown.includes('Anastrozole: Included'))
})

test('a charged ancillary is totalled separately from the subscription', () => {
  const quote = quoteOf([TESTOSTERONE, HCG])
  const breakdown = pricingBreakdown(quote)

  assert.ok(breakdown.includes('HCG 10,000 units: $300.00'))
  assert.ok(breakdown.includes('Ancillary Total: $300.00'))

  const { text } = protocolEmail({ firstName: 'Dan', quote })
  assert.match(text, /Total Due Today: \$437\.39/)
})

test('the recurring charge is stated, not left to be discovered', () => {
  const { text } = protocolEmail({ firstName: 'Dan', quote: quoteOf([TESTOSTERONE, HCG]) })

  // The one-time ancillary is in today's total but not in the recurring one.
  assert.match(text, /you will see a charge of \$137\.39 every month\./)
  assert.match(text, /includes your Monthly subscription and one-time ancillary medications/)
})

test('a protocol with no recurring plan drops the subscription sections', () => {
  const { text } = protocolEmail({ firstName: 'Dan', quote: quoteOf([HCG]) })

  // Nothing recurs, so promising a monthly charge would be a lie.
  assert.equal(text.includes('BANK STATEMENT:'), false)
  assert.equal(text.includes('HOW IT WORKS:'), false)
  assert.equal(text.includes('PAYMENT TERMS:'), false)

  assert.match(text, /Total Due Today: \$300\.00/)
  // Still tells them how the order gets to them.
  assert.match(text, /FIRST ORDER:/)
})

test('both parts point at the page that takes the payment', () => {
  const email = protocolEmail({ firstName: 'Dan', quote: quoteOf([TESTOSTERONE]) })

  assert.match(email.text, /\/profile\/recommended-protocol/)
  assert.match(email.html, /href="[^"]*\/profile\/recommended-protocol"/)
})

test('a plain text part is always sent alongside the HTML', () => {
  // A client that renders the text part must not show an empty message with no
  // way to accept — the same rule as the consultation invite.
  const email = protocolEmail({ firstName: 'Dan', quote: quoteOf([TESTOSTERONE]) })

  assert.ok(email.text.trim().length > 200)
  assert.ok(email.html.includes('<!DOCTYPE html>'))
})

test('a name with markup in it cannot break the HTML', () => {
  const email = protocolEmail({
    firstName: '<script>alert(1)</script>',
    quote: quoteOf([TESTOSTERONE]),
  })

  assert.equal(email.html.includes('<script>'), false)
  assert.match(email.html, /&lt;script&gt;/)
})
