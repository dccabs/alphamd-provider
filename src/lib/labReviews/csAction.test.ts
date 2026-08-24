import assert from 'node:assert/strict'
import test from 'node:test'

import { planCsAction } from './csAction.ts'

test('empty customer-service text is a skip', () => {
  assert.deepEqual(
    planCsAction({ customerService: '  \n  ', dispositionLabel: 'Follow-up needed' }),
    { kind: 'skip' }
  )
})

test('non-empty text becomes an action assigned for that disposition', () => {
  assert.deepEqual(
    planCsAction({
      customerService: '  New medication — Testosterone cypionate: 160mg/week.  ',
      dispositionLabel: 'Follow-up needed',
    }),
    {
      kind: 'create',
      title: 'Lab review — Follow-up needed',
      description: 'New medication — Testosterone cypionate: 160mg/week.',
    }
  )
})
