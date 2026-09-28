import assert from 'node:assert/strict'
import test from 'node:test'

import { EMPTY_ANSWER_DRAFT, parseAnswerDraft, type AnswerDraft } from './answerDraft.ts'
import {
  ANSWER_TICKET_SUBJECT,
  planAnswerDelivery,
  planFinish,
  validateFinish,
} from './finish.ts'

const QUESTION = 'Can I move my injection day from Monday to Thursday this week?'

const draft = (patch: Partial<AnswerDraft> = {}): AnswerDraft => ({
  ...EMPTY_ANSWER_DRAFT,
  patientMessage: 'Yes — one shift of a few days is fine. Keep the same dose.',
  ...patch,
})

const plan = (patch: Partial<AnswerDraft> = {}) =>
  planFinish({
    question: QUESTION,
    csComments: 'Patient is travelling.',
    draft: draft(patch),
    providerName: 'Jonathan Meyer',
  })

// ---------------------------------------------------------------------------
// Required message, no disposition

test('finishing requires a patient message and nothing else', () => {
  assert.deepEqual(validateFinish(draft()), [])
  assert.deepEqual(validateFinish(draft({ patientMessage: '   ' })), [
    'Write the message to the patient. Finishing a Provider Question is answering it.',
  ])
})

test('a dose change with a medication but no dose is refused', () => {
  const problems = validateFinish(
    draft({
      doseChanges: [{ medicationId: 1, medication: 'Testosterone', from: '', value: '', sig: '' }],
    })
  )
  assert.equal(problems.length, 1)
  assert.match(problems[0], /dose/i)
})

test('the draft has no disposition to parse and tolerates an old or empty column', () => {
  assert.deepEqual(parseAnswerDraft(null), EMPTY_ANSWER_DRAFT)
  assert.deepEqual(parseAnswerDraft({ disposition: 'continue_protocol' }), EMPTY_ANSWER_DRAFT)
  assert.equal(parseAnswerDraft({ patientMessage: 'hi', followUp: true }).followUp, true)
  assert.equal(parseAnswerDraft({ patientMessage: 'hi' }).patientMessage, 'hi')
  assert.equal(parseAnswerDraft({ questionRecap: 'You asked.' }).questionRecap, 'You asked.')
})

// ---------------------------------------------------------------------------
// Zendesk: reply on the linked ticket, or a new ticket

test('with a linked ticket the answer is a reply on that ticket, verbatim', () => {
  assert.deepEqual(planAnswerDelivery({ ticketId: '4410', answer: 'Yes.', questionRecap: RECAP }), {
    kind: 'reply',
    ticketId: '4410',
    body: 'Yes.',
  })
})

const RECAP = 'You asked whether you can move your injection day this week.'

test('without a ticket the answer is a new ticket: greeting, the recap, the answer, sign-off', () => {
  const delivery = planAnswerDelivery({
    ticketId: null,
    answer: ' Yes. ',
    firstName: 'Jerry',
    questionRecap: ` ${RECAP} `,
  })
  assert.equal(delivery.kind, 'new-ticket')
  if (delivery.kind !== 'new-ticket') return
  assert.equal(delivery.subject, ANSWER_TICKET_SUBJECT)
  assert.equal(
    delivery.body,
    [
      'Hi Jerry,',
      'We received your question:',
      RECAP,
      'Provider answer:',
      'Yes.',
      'Please reply to this message if you have more questions or concerns.',
      'Thank you,\nAlphaMD Support',
    ].join('\n\n')
  )
})

test('the question text itself is never pasted into the ticket', () => {
  const delivery = planAnswerDelivery({ ticketId: null, answer: 'Yes.', questionRecap: RECAP })
  assert.equal(delivery.body.includes(QUESTION), false)
})

test('with no recap the letter acknowledges the question without restating it', () => {
  const delivery = planAnswerDelivery({ ticketId: null, answer: 'Yes.' })
  assert.ok(delivery.body.startsWith('Hi there,\n\nWe received your question.\n\nProvider answer:'))
})

test('the fallback ticket body for a failed reply is the same new-ticket body', () => {
  const fresh = planAnswerDelivery({ ticketId: null, answer: 'Yes.', questionRecap: RECAP })
  const fallback = planAnswerDelivery({
    ticketId: '4410',
    answer: 'Yes.',
    questionRecap: RECAP,
    replyFailed: true,
  })
  assert.deepEqual(fallback, fresh)
})

// ---------------------------------------------------------------------------
// The Provider Question Note

test('the chart note leads with the AI summary and carries question and answer', () => {
  const p = plan({ chartSummary: 'Confirmed a one-off injection day shift; no dose change.' })
  assert.ok(p.note.startsWith('Confirmed a one-off injection day shift; no dose change.'))
  assert.ok(p.note.includes(`Question: ${QUESTION}`))
  assert.ok(p.note.includes('Answer: Yes — one shift of a few days is fine. Keep the same dose.'))
})

test('without an AI summary the note falls back to a plain provider line', () => {
  const p = plan({ chartSummary: '' })
  assert.ok(p.note.startsWith('Provider Question answered by Jonathan Meyer.'))
})

test('the events the AI summary is written from name the question, the answer and CS context', () => {
  const p = plan()
  assert.match(p.events, /^Provider Question answered by Jonathan Meyer\./)
  assert.ok(p.events.includes(QUESTION))
  assert.ok(p.events.includes('Customer service context: Patient is travelling.'))
})

// ---------------------------------------------------------------------------
// Toolkit: CS Open Action only when requested; follow-up flag only when asked

test('a plain answer creates no customer service action and no flag', () => {
  const p = plan()
  assert.equal(p.csAction, null)
  assert.deepEqual(p.addFlagIds, [])
})

test('request from CS creates an Open Action titled as a Provider Question', () => {
  const p = plan({ csInstructions: 'Move his next shipment out a week.' })
  assert.deepEqual(p.csAction, {
    title: 'Provider Question — answered',
    description: 'Move his next shipment out a week.',
  })
})

test('a dose change is a request of customer service too, since somebody has to update the prescription', () => {
  const p = plan({
    doseChanges: [
      { medicationId: 7, medication: 'Anastrozole', from: '1mg', value: '0.5mg', sig: '' },
    ],
  })
  assert.ok(p.csAction)
  assert.match(p.csAction!.description, /Dose change — Anastrozole: 1mg → 0\.5mg\./)
  assert.ok(p.note.includes('Dose change: Anastrozole — 0.5mg (was 1mg)'))
})

test('follow-up sets the Follow Up Required flag; otherwise no flag is touched', () => {
  assert.deepEqual(plan({ followUp: true }).addFlagIds, [2])
  assert.deepEqual(plan({ followUp: false }).addFlagIds, [])
})

test('labs and a consultation are listed on the note so the chart says they went out', () => {
  const p = plan({
    labOrders: [
      {
        providerId: 'lp1',
        timing: 'now',
        customDate: '',
        testCodes: ['CBC'],
        requiredCodes: [],
        diagnosisCodes: [],
        compedCodes: [],
      },
    ],
  })
  assert.ok(p.note.includes('Labs ordered:'))
})
