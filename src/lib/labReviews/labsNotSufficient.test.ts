import assert from 'node:assert/strict'
import test from 'node:test'

import { EMPTY_ORDER, type LabOrder } from '../labOrders/order.ts'
import {
  insufficientChartNote,
  insufficientPatientMessage,
  insufficientReasonsLine,
  parseInsufficientReasons,
  withInsufficientPrefill,
} from './labsNotSufficient.ts'
import { EMPTY_DRAFT, type ReviewDraft } from './reviewDraft.ts'

const draft = (patch: Partial<ReviewDraft> = {}): ReviewDraft => ({
  ...EMPTY_DRAFT,
  disposition: 'labs_not_sufficient',
  ...patch,
})

const order: LabOrder = {
  ...EMPTY_ORDER,
  timing: 'in_12_weeks',
  providerId: 'provider-uuid',
  testCodes: ['testosterone_total_84403'],
}

test('the chart note lists each reason, Other in the provider\'s words', () => {
  assert.equal(
    insufficientChartNote(
      draft({ insufficientReasons: ['no_dob', 'altered', 'other'], insufficientOther: 'Two names' })
    ),
    [
      'Labs not sufficient — not accepted for review:',
      "- Report does not show the patient's date of birth.",
      '- Report appears to have been altered; not accepted as submitted.',
      '- Other: Two names',
    ].join('\n')
  )
})

test('nothing is prefilled without a reason, or under another disposition', () => {
  assert.equal(insufficientChartNote(draft()), '')
  assert.equal(insufficientPatientMessage(draft(), 'Sam'), '')
  const elsewhere = draft({ disposition: 'follow_up_needed', insufficientReasons: ['no_name'] })
  assert.equal(insufficientChartNote(elsewhere), '')
  assert.equal(insufficientPatientMessage(elsewhere, 'Sam'), '')
  assert.equal(insufficientReasonsLine(elsewhere), '')
})

test('Other with nothing written says nothing yet', () => {
  assert.equal(insufficientChartNote(draft({ insufficientReasons: ['other'] })), '')
})

test('the patient message never repeats the accusation', () => {
  const message = insufficientPatientMessage(draft({ insufficientReasons: ['altered'] }), 'Sam')
  assert.doesNotMatch(message, /alter|fake|tamper|fraud/i)
  assert.match(message, /weren't able to verify the report as submitted/)
})

test('the patient message does not carry the Other text', () => {
  const message = insufficientPatientMessage(
    draft({ insufficientReasons: ['no_name', 'other'], insufficientOther: 'Looks photoshopped' }),
    'Sam'
  )
  assert.doesNotMatch(message, /photoshopped/)
})

test('without missing markers, the patient is asked for an updated report', () => {
  assert.equal(
    insufficientPatientMessage(draft({ insufficientReasons: ['no_name', 'too_old'] }), 'Sam'),
    [
      'Hi Sam,',
      "Thank you for sending in your lab results. Your provider reviewed them, but we aren't able to use this report for your review yet:\n\n" +
        "- The report doesn't show your name, which we need to match the results to you.\n" +
        '- The results were collected more than 90 days ago, and we need labs from the last 90 days to make treatment decisions.',
      "Once you have an updated report, upload it to your account and we'll review it right away.",
      'If you have any questions, just reply to this message.',
    ].join('\n\n')
  )
})

test('missing markers with a lab order staged says the order is on its way', () => {
  const message = insufficientPatientMessage(
    draft({ insufficientReasons: ['more_markers'], labOrders: [order] }),
    'Sam'
  )
  assert.match(message, /We've sent you a lab order for the additional tests/)
  assert.doesNotMatch(message, /upload it to your account/)
})

test('missing markers with no order still explains the problem and offers help', () => {
  const message = insufficientPatientMessage(draft({ insufficientReasons: ['more_markers'] }), 'Sam')
  assert.match(message, /doesn't include all of the markers/)
  assert.match(message, /Our team can help you get the additional tests done/)
  assert.doesNotMatch(message, /sent you a lab order/)
})

test('a patient with no first name on file is greeted without one', () => {
  assert.match(
    insufficientPatientMessage(draft({ insufficientReasons: ['no_name'] }), null),
    /^Hi there,/
  )
})

test('stored reasons come back in listing order', () => {
  assert.deepEqual(parseInsufficientReasons(['altered', 'no_name', 'nope']), ['no_name', 'altered'])
  assert.deepEqual(parseInsufficientReasons('no_name'), [])
})

test('checking a reason fills empty boxes', () => {
  const before = draft()
  const after = withInsufficientPrefill(before, { ...before, insufficientReasons: ['no_name'] }, 'Sam')
  assert.equal(after.providerNote, insufficientChartNote(after))
  assert.equal(after.patientMessage, insufficientPatientMessage(after, 'Sam'))
  assert.notEqual(after.providerNote, '')
})

test('prefilled text follows the reasons while it is untouched', () => {
  const one = withInsufficientPrefill(draft(), draft({ insufficientReasons: ['no_name'] }), 'Sam')
  const two = withInsufficientPrefill(one, { ...one, insufficientReasons: ['no_name', 'no_dob'] }, 'Sam')
  assert.match(two.providerNote, /date of birth/)
  assert.match(two.patientMessage, /date of birth/)
})

test('staging a lab order rewrites an untouched patient message', () => {
  const one = withInsufficientPrefill(draft(), draft({ insufficientReasons: ['more_markers'] }), 'Sam')
  const two = withInsufficientPrefill(one, { ...one, labOrders: [order] }, 'Sam')
  assert.match(two.patientMessage, /We've sent you a lab order/)
})

test('an edited box is never overwritten', () => {
  const one = withInsufficientPrefill(draft(), draft({ insufficientReasons: ['no_name'] }), 'Sam')
  const edited = { ...one, providerNote: 'My own note.', patientMessage: 'My own message.' }
  const two = withInsufficientPrefill(edited, { ...edited, insufficientReasons: ['no_name', 'too_old'] }, 'Sam')
  assert.equal(two.providerNote, 'My own note.')
  assert.equal(two.patientMessage, 'My own message.')
})

test('text written before choosing the disposition is kept', () => {
  const before = draft({ disposition: 'follow_up_needed', providerNote: 'Reviewed.' })
  const after = withInsufficientPrefill(
    before,
    { ...before, disposition: 'labs_not_sufficient', insufficientReasons: ['no_name'] },
    'Sam'
  )
  assert.equal(after.providerNote, 'Reviewed.')
})

test('moving to another disposition clears untouched prefill, which would be untrue there', () => {
  const one = withInsufficientPrefill(draft(), draft({ insufficientReasons: ['no_name'] }), 'Sam')
  const two = withInsufficientPrefill(one, { ...one, disposition: 'follow_up_needed' }, 'Sam')
  assert.equal(two.providerNote, '')
  assert.equal(two.patientMessage, '')
})

test('typing in a box is left alone', () => {
  const one = withInsufficientPrefill(draft(), draft({ insufficientReasons: ['no_name'] }), 'Sam')
  const typed = withInsufficientPrefill(one, { ...one, providerNote: `${one.providerNote} More.` }, 'Sam')
  assert.equal(typed.providerNote, `${one.providerNote} More.`)
})
