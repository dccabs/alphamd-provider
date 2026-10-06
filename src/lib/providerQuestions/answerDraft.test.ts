import assert from 'node:assert/strict'
import test from 'node:test'

import { EMPTY_ORDER } from '../labOrders/order.ts'
import { EMPTY_ANSWER_DRAFT, toolkitItems, type AnswerDraft } from './answerDraft.ts'

const draft = (patch: Partial<AnswerDraft> = {}): AnswerDraft => ({
  ...EMPTY_ANSWER_DRAFT,
  patientMessage: 'Yes, that is fine.',
  ...patch,
})

test('a message-only draft has nothing beyond the reply', () => {
  assert.deepEqual(toolkitItems(draft()), [])
})

test('the chart summary is not a toolkit item', () => {
  assert.deepEqual(toolkitItems(draft({ chartSummary: 'Answered a scheduling question.' })), [])
})

test('an untouched dose change row does not count', () => {
  const blank = { medicationId: null, medication: '', from: '', value: '', sig: '' }
  assert.deepEqual(toolkitItems(draft({ doseChanges: [blank] })), [])
})

test('each toolkit entry is named, in the Answer panel order', () => {
  const items = toolkitItems(
    draft({
      doseChanges: [
        { medicationId: 1, medication: 'Testosterone', from: '0.5 mL', value: '', sig: '' },
      ],
      labOrders: [EMPTY_ORDER],
      consultation: { eventTypeId: 'x', message: '', bookingUrl: '', expiresAt: null },
      csInstructions: 'Move the shipment a week.',
    })
  )
  assert.deepEqual(items, [
    'a dose change',
    'labs',
    'a consultation',
    'a request to customer service',
  ])
})

test('blank customer service text does not count', () => {
  assert.deepEqual(toolkitItems(draft({ csInstructions: '   ' })), [])
})
