import assert from 'node:assert/strict'
import test from 'node:test'

import { orderContentLines } from './orders.ts'

test('splits a medication name off the sig', () => {
  assert.deepEqual(
    orderContentLines(
      'Testosterone cypionate - Inject .4mL subcutaneously twice weekly on same days every week.'
    ),
    [
      {
        name: 'Testosterone cypionate',
        detail: 'Inject .4mL subcutaneously twice weekly on same days every week.',
      },
    ]
  )
})

test('keeps later separators in the detail', () => {
  assert.deepEqual(orderContentLines('HCG - 500 Units Weekly - Mix with 10ML solvent.'), [
    { name: 'HCG', detail: '500 Units Weekly - Mix with 10ML solvent.' },
  ])
})

test('splits on an en dash', () => {
  assert.deepEqual(orderContentLines('Tadalafil – 5mg tablet, 1 tablet PO daily as needed'), [
    { name: 'Tadalafil', detail: '5mg tablet, 1 tablet PO daily as needed' },
  ])
})

test('strips the shipping automation note', () => {
  assert.deepEqual(
    orderContentLines('Tirzepatide - Inject 0.45ml weekly\n\nShipped, Email sent on 08/07/2026'),
    [{ name: 'Tirzepatide', detail: 'Inject 0.45ml weekly' }]
  )
})

test('an order whose only text is the automation note has no contents', () => {
  assert.deepEqual(orderContentLines('\n\nShipped, Email sent on 06/18/2025'), [])
})

test('keeps a human note that merely mentions shipping', () => {
  assert.deepEqual(orderContentLines('System added tracking number to wrong order.'), [
    { name: null, detail: 'System added tracking number to wrong order.' },
  ])
})

test('keeps a shipping note carrying extra commentary', () => {
  const line = 'Shipped, Email sent on 08/06/2026 (Patient received the sermorelin not the TRT)'
  assert.deepEqual(orderContentLines(line), [{ name: null, detail: line }])
})

test('a continuation line stays its own line rather than becoming a medication', () => {
  assert.deepEqual(
    orderContentLines(
      'Testosterone cypionate - 105mg/wk\nInject 0.15mL subcutaneously every other day.'
    ),
    [
      { name: 'Testosterone cypionate', detail: '105mg/wk' },
      { name: null, detail: 'Inject 0.15mL subcutaneously every other day.' },
    ]
  )
})

test('a bare name is kept as text, not bolded as a name', () => {
  assert.deepEqual(orderContentLines('TRT'), [{ name: null, detail: 'TRT' }])
})

test('a pharmacy pick list is not split into a name', () => {
  const line =
    'TESTOSTERONE CYPIONATE/ DHEA 200/ 25MG/ ML 10mL INJECTABLE 1 SURE COMFORT 0.5 ML 29G X 1/ 2" 10 CT SUPPLIES 3'
  assert.deepEqual(orderContentLines(line), [{ name: null, detail: line }])
})

test('a hyphenated word is not a separator', () => {
  assert.deepEqual(orderContentLines('Semaglutide/B-12 compound 2.5mg/ml'), [
    { name: null, detail: 'Semaglutide/B-12 compound 2.5mg/ml' },
  ])
})

for (const empty of [null, '', '   ', '\n\n']) {
  test(`no contents for ${JSON.stringify(empty)}`, () => {
    assert.deepEqual(orderContentLines(empty), [])
  })
}
