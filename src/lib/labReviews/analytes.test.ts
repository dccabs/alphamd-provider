import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collectionTime,
  latestCollection,
  orderAnalytes,
  type Analyte,
  type AnalyteCollection,
} from './analytes.ts'

const analyte = (name: string): Analyte => ({ name, value: '1' })
const names = (analytes: Analyte[]) => orderAnalytes(analytes).map((a) => a.name)

/** What jsonb key ordering actually hands back — length, then bytewise. */
const AS_STORED = [
  'LH',
  'PSA',
  'SHBG',
  'Estradiol',
  'Prolactin',
  'Hematocrit',
  'Hemoglobin',
  'Free Testosterone',
  'Total Testosterone',
].map(analyte)

test('the values that decide a dose lead', () => {
  assert.deepEqual(names(AS_STORED).slice(0, 4), [
    'Total Testosterone',
    'Hematocrit',
    'Estradiol',
    'PSA',
  ])
})

test('a full panel comes back in reading order', () => {
  assert.deepEqual(names(AS_STORED), [
    'Total Testosterone',
    'Hematocrit',
    'Estradiol',
    'PSA',
    'Free Testosterone',
    'SHBG',
    'Hemoglobin',
    'LH',
    'Prolactin',
  ])
})

test('a missing analyte closes the gap rather than leaving one', () => {
  // PSA is populated on only 41% of collections, so this is the common case.
  assert.deepEqual(names(AS_STORED.filter((a) => a.name !== 'PSA')).slice(0, 4), [
    'Total Testosterone',
    'Hematocrit',
    'Estradiol',
    'Free Testosterone',
  ])
})

test('an analyte the extractor adds later is kept, after the known ones', () => {
  assert.deepEqual(names([analyte('TSH'), analyte('LH'), analyte('Hematocrit')]), [
    'Hematocrit',
    'LH',
    'TSH',
  ])
})

test('unknown keys keep the order they arrived in', () => {
  assert.deepEqual(names([analyte('TSH'), analyte('Ferritin'), analyte('PSA')]), [
    'PSA',
    'TSH',
    'Ferritin',
  ])
})

test('nothing extracted', () => {
  assert.deepEqual(orderAnalytes([]), [])
})

test('the input array is not reordered in place', () => {
  const input = [analyte('LH'), analyte('Total Testosterone')]
  orderAnalytes(input)
  assert.deepEqual(
    input.map((a) => a.name),
    ['LH', 'Total Testosterone']
  )
})

const collection = (collectionDate: string | null): AnalyteCollection => ({
  collectionDate,
  fileName: collectionDate,
  analytes: [],
})

const picked = (dates: (string | null)[]) =>
  latestCollection(dates.map(collection))?.collectionDate

test('every date format in production parses', () => {
  assert.equal(collectionTime('01/15/26'), Date.UTC(2026, 0, 15))
  assert.equal(collectionTime('1/16/26'), Date.UTC(2026, 0, 16))
  assert.equal(collectionTime('04/11/2026'), Date.UTC(2026, 3, 11))
  assert.equal(collectionTime('06-14-23'), Date.UTC(2023, 5, 14))
  assert.equal(collectionTime('2026-08-13'), Date.UTC(2026, 7, 13))
})

test('a month without a day, or a phrase, is not a date', () => {
  assert.equal(collectionTime('04/2026'), null)
  assert.equal(collectionTime('Multiple dates'), null)
  assert.equal(collectionTime(''), null)
  assert.equal(collectionTime(null), null)
})

test('an impossible month or day is rejected rather than rolled over', () => {
  assert.equal(collectionTime('13/01/26'), null)
  assert.equal(collectionTime('12/40/26'), null)
})

test('the newest result set wins even when it is not first in the array', () => {
  // The real shape of report 057f8750, where taking [0] returns the older panel.
  assert.equal(picked(['01/15/26', '1/16/26']), '1/16/26')
  assert.equal(picked(['03/24/25', '04/11/2026']), '04/11/2026')
})

test('a date that cannot be read never beats one that can', () => {
  assert.equal(picked(['Multiple dates', '02/11/26']), '02/11/26')
  assert.equal(picked(['7/29/26', '08/21/24', '06-14-23']), '7/29/26')
})

test('with no readable date anywhere, the first entry stands', () => {
  assert.equal(picked(['04/2026', 'Multiple dates']), '04/2026')
  assert.equal(picked([null]), null)
})

test('the earliest entry wins a tie', () => {
  const first = { ...collection('05/04/26'), fileName: 'first' }
  const second = { ...collection('5/4/26'), fileName: 'second' }
  assert.equal(latestCollection([first, second])?.fileName, 'first')
})

test('no collections', () => {
  assert.equal(latestCollection([]), null)
})
