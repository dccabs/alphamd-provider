import assert from 'node:assert/strict'
import test from 'node:test'

import {
  expirationLabel,
  expiryStatus,
  medicationSummaryLine,
  orderMedications,
  shortMedicationName,
} from './medications.ts'

/** A fixed "now" so nothing here depends on the day the suite runs. */
const NOW = new Date('2026-08-17T14:00:00Z')

test('a date after today is in the future', () => {
  assert.equal(expiryStatus('2026-12-01', NOW), 'future')
  assert.equal(expiryStatus('2027-01-15T00:00:00Z', NOW), 'future')
})

test('a date before today is in the past', () => {
  assert.equal(expiryStatus('2026-01-04', NOW), 'past')
  assert.equal(expiryStatus('2019-11-30T00:00:00Z', NOW), 'past')
})

// A date-only string parses to midnight UTC, so this is the case that breaks if
// the comparison is ever made against midnight local: the row would render
// "08/17/26" and colour it as though it had already gone.
test('a prescription expiring today has not expired', () => {
  assert.equal(expiryStatus('2026-08-17', NOW), 'future')
  assert.equal(expirationLabel('2026-08-17'), '08/17/26')
})

test('the last hours of the day before are still past', () => {
  assert.equal(expiryStatus('2026-08-16T23:59:59Z', NOW), 'past')
})

// Same instant, either side of midnight UTC: the answer must not depend on what
// time of day the review is being done.
test('the verdict does not move with the hour', () => {
  for (const hour of ['00:30', '12:00', '23:30']) {
    const at = new Date(`2026-08-17T${hour}:00Z`)
    assert.equal(expiryStatus('2026-08-17', at), 'future', `wrong at ${hour}`)
    assert.equal(expiryStatus('2026-08-16', at), 'past', `wrong at ${hour}`)
  }
})

test('an empty column is unknown rather than expired', () => {
  // Over a third of the rows are like this, and `getMedications` reads the
  // emptiness as active.
  assert.equal(expiryStatus(null, NOW), 'unknown')
  assert.equal(expiryStatus('', NOW), 'unknown')
  assert.equal(expiryStatus('   ', NOW), 'unknown')
})

test('an unparseable column is unknown rather than expired', () => {
  assert.equal(expiryStatus('none', NOW), 'unknown')
  assert.equal(expiryStatus('n/a', NOW), 'unknown')
})

test('a readable date gets a label and an unreadable one gets none', () => {
  assert.equal(expirationLabel('2026-12-01'), '12/01/26')
  assert.equal(expirationLabel(null), null)
  assert.equal(expirationLabel(''), null)
  assert.equal(expirationLabel('nope'), null)
})

test('testosterone comes first', () => {
  const ordered = orderMedications([
    { name: 'Anastrozole' },
    { name: 'Testosterone Cypionate' },
    { name: 'HCG' },
  ])

  assert.deepEqual(ordered.map((m) => m.name), [
    'Testosterone Cypionate',
    'Anastrozole',
    'HCG',
  ])
})

// Ordering by name is safe in a way the dosing calculator's gate is not: the cream
// is not 200mg/mL, but it is still what a provider means by "the testosterone".
test('the cream and the gel count as testosterone too', () => {
  const ordered = orderMedications([{ name: 'Anastrozole' }, { name: 'Testosterone cream' }])
  assert.equal(ordered[0].name, 'Testosterone cream')
})

test('everything else keeps the order it arrived in', () => {
  const ordered = orderMedications([
    { name: 'Anastrozole' },
    { name: 'HCG' },
    { name: 'Testosterone Enanthate' },
    { name: 'Semaglutide' },
  ])

  assert.deepEqual(ordered.map((m) => m.name), [
    'Testosterone Enanthate',
    'Anastrozole',
    'HCG',
    'Semaglutide',
  ])
})

test('two testosterones keep their order relative to each other', () => {
  const ordered = orderMedications([
    { name: 'Testosterone Cypionate' },
    { name: 'Anastrozole' },
    { name: 'Testosterone cream' },
  ])

  assert.deepEqual(ordered.map((m) => m.name), [
    'Testosterone Cypionate',
    'Testosterone cream',
    'Anastrozole',
  ])
})

test('cypionate shortens on the snapshot line', () => {
  assert.equal(shortMedicationName('Testosterone cypionate'), 'Testosterone cyp')
  assert.equal(shortMedicationName('HCG'), 'HCG')
})

test('the snapshot line is the active names, with a weekly dose when it is known', () => {
  assert.equal(
    medicationSummaryLine([
      {
        name: 'Anastrozole',
        dosage: '1.00mg - Take 1/2 tablet (0.50mg) by mouth twice weekly.',
        active: true,
      },
      {
        name: 'HCG',
        dosage: '1,000 Units Weekly - Mix with 10ML solvent.',
        active: true,
      },
      {
        name: 'Testosterone cypionate',
        dosage: 'Inject .4mL subcutaneously twice weekly on same days every week.',
        active: true,
      },
    ]),
    'Testosterone cyp - 160mg, Anastrozole, HCG'
  )
})

test('expired prescriptions stay off the snapshot line', () => {
  assert.equal(
    medicationSummaryLine([
      { name: 'Testosterone cypionate', dosage: 'Inject .4mL subcutaneously twice weekly.', active: false },
      { name: 'HCG', dosage: '1,000 Units Weekly', active: true },
    ]),
    'HCG'
  )
})

test('a cream is named without a invented milligram figure', () => {
  assert.equal(
    medicationSummaryLine([
      { name: 'Testosterone cream', dosage: 'Apply 3 clicks daily.', active: true },
    ]),
    'Testosterone cream'
  )
})

test('the caller’s array is not reordered underneath it', () => {
  const original = [{ name: 'Anastrozole' }, { name: 'Testosterone Cypionate' }]
  orderMedications(original)
  assert.equal(original[0].name, 'Anastrozole')
})
