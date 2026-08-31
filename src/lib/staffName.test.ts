import assert from 'node:assert/strict'
import test from 'node:test'

import { staffDisplayName } from './staffName.ts'

test('first and last name become the chart name', () => {
  assert.equal(staffDisplayName({ firstName: 'Saba', lastName: 'Mallah' }, 'saba@alphamd.org'), 'Saba Mallah')
})

test('a missing user_list row falls back to the email', () => {
  assert.equal(staffDisplayName(null, 'brandons@alphamd.org'), 'brandons@alphamd.org')
})

test('blank names fall back to the email', () => {
  assert.equal(
    staffDisplayName({ firstName: '  ', lastName: null }, 'fresh@alphamd.org'),
    'fresh@alphamd.org',
  )
})

test('a first name alone is enough', () => {
  assert.equal(staffDisplayName({ firstName: 'Saba', lastName: null }, 'saba@alphamd.org'), 'Saba')
})
