import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_PER_WEEK,
  DEFAULT_WEEKLY_MG,
  PERSONAL,
  initialSelection,
  selectionValue,
} from './doseSelection.ts'

const OPTIONS = [
  { id: 41, value: '1.00mg - Take 1/2 tablet (0.50mg) by mouth twice weekly.' },
  { id: 42, value: '1.00mg - Take 1 tablet by mouth twice weekly.' },
]

test('a calculated dose becomes a level and the instruction it works out to', () => {
  const selection = initialSelection({
    from: { weeklyMg: 140, perWeek: 2, route: 'subcutaneously' },
    options: [],
  })

  assert.equal(selection.weeklyMg, '140')
  assert.deepEqual(selectionValue(selection, { calculated: true, options: [] }), {
    value: '140mg/week',
    sig: 'Inject .35mL subcutaneously every 3.5 days. 200mg/mL.',
    // Carried as a number, because a protocol built on this dose is priced on it.
    weeklyMg: 140,
  })
})

test('with nothing on record the calculator opens on the male house default', () => {
  const selection = initialSelection({ options: [] })

  assert.equal(selection.weeklyMg, String(DEFAULT_WEEKLY_MG))
  assert.equal(selection.concentration, 200)
  assert.equal(selection.perWeek, DEFAULT_PER_WEEK)
  assert.equal(selection.route, 'subcutaneously')
})

test('starting a medication for a female Patient opens on 20mg/mL and 10mg/week', () => {
  const selection = initialSelection({
    options: [],
    patient: { gender: 'female', state: 'Texas' },
  })

  assert.equal(selection.weeklyMg, '10')
  assert.equal(selection.concentration, 20)
})

test('starting a medication for a California female opens on 50mg/mL', () => {
  const selection = initialSelection({
    options: [],
    patient: { gender: 'female', state: 'California' },
  })

  assert.equal(selection.weeklyMg, '10')
  assert.equal(selection.concentration, 50)
})

test('a dose change keeps the Concentration already on the prescription', () => {
  const selection = initialSelection({
    from: { weeklyMg: 140, perWeek: 2, route: 'subcutaneously', concentration: 200 },
    patient: { gender: 'female', state: 'Texas' },
    options: [],
  })

  assert.equal(selection.weeklyMg, '140')
  assert.equal(selection.concentration, 200)
})

test('a calculated dose at 20mg/mL writes that Concentration into the instruction', () => {
  const selection = {
    ...initialSelection({
      from: { weeklyMg: 10, perWeek: 1, route: 'subcutaneously', concentration: 20 },
      options: [],
    }),
  }

  assert.deepEqual(selectionValue(selection, { calculated: true, options: [] }), {
    value: '10mg/week',
    sig: 'Inject .5mL subcutaneously once weekly on the same day every week. 20mg/mL.',
    weeklyMg: 10,
  })
})

test('a catalog dose is recorded as written, with no generated instruction', () => {
  const selection = { ...initialSelection({ options: OPTIONS }), choice: '42' }

  assert.deepEqual(selectionValue(selection, { calculated: false, options: OPTIONS }), {
    value: '1.00mg - Take 1 tablet by mouth twice weekly.',
    sig: '',
    // Not dosed in weekly milligrams, so there is no figure to price a surcharge on.
    weeklyMg: null,
  })
})

test('nothing picked from a catalog is not a dose', () => {
  const selection = initialSelection({ options: OPTIONS })
  assert.equal(selectionValue(selection, { calculated: false, options: OPTIONS }), null)
})

test('a typed dose is read when it is chosen, and when there is nothing to choose', () => {
  const typed = { ...initialSelection({ options: OPTIONS }), choice: PERSONAL, personal: '  2mg PO daily  ' }

  assert.deepEqual(selectionValue(typed, { calculated: false, options: OPTIONS }), {
    value: '2mg PO daily',
    sig: '',
    weeklyMg: null,
  })

  // `Other` has no catalog doses at all, so the field is the only input and is
  // read without the provider having to select "personal" first.
  const only = { ...initialSelection({ options: [] }), personal: '2mg PO daily' }
  assert.deepEqual(selectionValue(only, { calculated: false, options: [] }), {
    value: '2mg PO daily',
    sig: '',
    weeklyMg: null,
  })
})

test('a figure left in the calculator cannot turn a tablet into an injection', () => {
  const selection = { ...initialSelection({ options: OPTIONS }), weeklyMg: '160' }

  assert.equal(selectionValue(selection, { calculated: false, options: OPTIONS }), null)
})

test('an empty or nonsense weekly dose is not a dose', () => {
  const selection = initialSelection({ options: [] })

  for (const weeklyMg of ['', '0', '-40', 'abc']) {
    assert.equal(
      selectionValue({ ...selection, weeklyMg }, { calculated: true, options: [] }),
      null,
      weeklyMg
    )
  }
})

test('reopening a confirmed change lands back on what was confirmed', () => {
  const selection = initialSelection({
    from: { weeklyMg: 140, perWeek: 2, route: 'subcutaneously' },
    previous: { value: '180mg/week', sig: '', perWeek: 3, route: 'intramuscularly' },
    options: [],
  })

  assert.equal(selection.weeklyMg, '180')
  assert.equal(selection.perWeek, 3)
  assert.equal(selection.route, 'intramuscularly')
})

test('reopening a catalog dose reselects the option it came from', () => {
  const selection = initialSelection({
    previous: { value: OPTIONS[1].value, sig: '' },
    options: OPTIONS,
  })

  assert.equal(selection.choice, '42')
  assert.equal(selection.personal, '')
})

test('reopening a dose that is in no catalog reads as a personal one', () => {
  const selection = initialSelection({
    previous: { value: '2mg PO daily', sig: '' },
    options: OPTIONS,
  })

  assert.equal(selection.choice, PERSONAL)
  assert.equal(selection.personal, '2mg PO daily')
})
