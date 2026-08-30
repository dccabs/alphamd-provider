import assert from 'node:assert/strict'
import test from 'node:test'

import {
  injectionSig,
  mlPerDose,
  offeredConcentrations,
  readDose,
  startingDose,
  weeklyMgLabel,
} from './dosing.ts'

/** Every sig quoted here is a real `medication_dosage_personal.value` from
 *  production, taken from the most common active rows. */

test('the house sig format reads back as weekly milligrams', () => {
  const dose = readDose({
    name: 'Testosterone cypionate',
    dosage: 'Inject .35mL subcutaneously twice weekly on same days every week. 14.3 weeks, (13 weeks). 29 supplies.',
  })

  assert.equal(dose.kind, 'injection')
  if (dose.kind !== 'injection') return

  assert.equal(dose.weeklyMg, 140)
  assert.equal(dose.perWeek, 2)
  assert.equal(dose.mlPerDose, 0.35)
  assert.equal(dose.concentration, 200)
  assert.equal(dose.route, 'subcutaneously')
})

test('"every 3.5 days" is twice weekly, not once', () => {
  const dose = readDose({
    name: 'Testosterone cypionate',
    dosage: 'Inject .3mL subcutaneously every 3.5 days.',
  })

  assert.equal(dose.kind === 'injection' && dose.perWeek, 2)
  assert.equal(dose.kind === 'injection' && dose.weeklyMg, 120)
})

test('three times weekly divides by three', () => {
  const dose = readDose({
    name: 'Testosterone cypionate',
    dosage: 'Inject .267mL subcutaneously three times weekly on same days every week.',
  })

  assert.equal(dose.kind === 'injection' && dose.perWeek, 3)
  assert.equal(dose.kind === 'injection' && dose.weeklyMg, 160)
})

test('a dose is read as the level it was prescribed at, not the arithmetic', () => {
  const level = (dosage: string) => {
    const dose = readDose({ name: 'Testosterone cypionate', dosage })
    return dose.kind === 'injection' ? dose.weeklyMg : null
  }

  // 180.6 and 200.2: the ten below.
  assert.equal(level('Inject .129mL subcutaneously daily.'), 180)
  assert.equal(level('Inject .143mL subcutaneously daily.'), 200)

  // 199.8, 169.8 and 159 all sit just under their level rather than over it, and
  // reading them down a step would understate the dose by ten.
  assert.equal(level('Inject .333mL subcutaneously three times weekly on same days every week.'), 200)
  assert.equal(level('Inject .283mL subcutaneously three times weekly on same days every week.'), 170)
  assert.equal(level('Inject 0.265mL subcutaneously three times weekly, on the same days each week.'), 160)

  // A dose between two levels is not lifted to the one above it.
  assert.equal(level('Inject .313mL subcutaneously twice weekly on same days every week.'), 120)

  // Too small to belong to a level, so it is left alone to be read as the
  // mistake it probably is.
  assert.equal(level('Inject .005mL subcutaneously once weekly on same days every week.'), 1)
})

test('an intramuscular sig keeps its route', () => {
  const dose = readDose({
    name: 'Testosterone cypionate',
    dosage: 'Inject .5mL intramuscularly twice weekly on same days every week.',
  })

  assert.equal(dose.kind === 'injection' && dose.route, 'intramuscularly')
  assert.equal(dose.kind === 'injection' && dose.weeklyMg, 200)
})

test('a stated 200mg/mL concentration is not mistaken for the volume', () => {
  // The `200mg/mL` leads the string, and `SQ` is the only route it gives.
  const dose = readDose({
    name: 'Testosterone cypionate',
    dosage: '200mg/mL – 0.35mL SQ every 3.5 days',
  })

  assert.equal(dose.kind === 'injection' && dose.mlPerDose, 0.35)
  assert.equal(dose.kind === 'injection' && dose.weeklyMg, 140)
  assert.equal(dose.kind === 'injection' && dose.route, 'subcutaneously')
})

test('a stated 20mg/mL Concentration is read, not assumed to be 200', () => {
  const dose = readDose({
    name: 'Testosterone cypionate',
    dosage: 'Inject .5mL subcutaneously once weekly on the same day every week. 20mg/mL.',
  })

  assert.equal(dose.kind, 'injection')
  if (dose.kind !== 'injection') return
  assert.equal(dose.concentration, 20)
  assert.equal(dose.mlPerDose, 0.5)
  assert.equal(dose.weeklyMg, 10)
})

test('the pricing modal phrasing of 50mg/mL is read the same way', () => {
  const dose = readDose({
    name: 'Testosterone cypionate',
    dosage:
      'Inject .2mL subcutaneously once weekly on the same day every week. 50mg/mL concentration. 10mg weekly',
  })

  assert.equal(dose.kind, 'injection')
  if (dose.kind !== 'injection') return
  assert.equal(dose.concentration, 50)
  assert.equal(dose.weeklyMg, 10)
})

test('a 15mg Weekly dose at 20mg/mL is not snapped to a 10mg level', () => {
  const dose = readDose({
    name: 'Testosterone cypionate',
    dosage: 'Inject .75mL subcutaneously once weekly on the same day every week. 20mg/mL.',
  })

  assert.equal(dose.kind === 'injection' && dose.weeklyMg, 15)
})

test('a Concentration that is not 20, 50 or 200 is refused rather than assumed', () => {
  const dose = readDose({
    name: 'Testosterone cypionate',
    dosage: '100mg/mL – 0.35mL SQ every 3.5 days',
  })

  assert.equal(dose.kind, 'opaque')
})

test('the 200mg/mL concentration is never applied to another injectable', () => {
  // Each of these is a real active sig. Reading the mL and multiplying by 200
  // would report a dose that has nothing to do with what the patient is on.
  const others = [
    {
      name: 'HCG',
      dosage:
        '500 Units Weekly - Mix with 10ML solvent (provided by pharmacy). Inject 0.25ml (250ius) subcutaneously twice weekly, on the same days each week. 20w(19w), 40 supplies.',
    },
    {
      name: 'Sermorelin',
      dosage: '0.10ml subcutaneously once daily at bedtime, 5 days per week with 2 days off',
    },
    {
      name: 'Semaglutide',
      dosage:
        '1.00mg weekly. Anazao pharmacy brand. Inject 0.2ML subcutaneously once weekly, on the same day each week',
    },
    { name: 'Nandrolone', dosage: 'Inject 0.25ml subcutaneously twice weekly, on the same days each week' },
    { name: 'Tirzepatide', dosage: 'Inject 0.45ml subcutaneously once weekly on the same day each week' },
  ]

  for (const med of others) {
    assert.equal(readDose(med).kind, 'opaque', med.name)
  }
})

test('an oral, a cream and a missing dosage are all opaque', () => {
  assert.equal(
    readDose({
      name: 'Anastrozole',
      dosage: '1.00mg - Take 1/2 tablet (0.50mg) by mouth twice weekly, on the same days each week.',
    }).kind,
    'opaque'
  )

  // Cream is dosed in clicks, so there is no volume to read at all.
  assert.equal(
    readDose({
      name: 'Testosterone Cream',
      dosage: 'Apply 3 clicks daily. ~140mg/week delivered at ~6.7mg per click (200mg/mL cream)',
    }).kind,
    'opaque'
  )

  const empty = readDose({ name: 'Other', dosage: null })
  assert.equal(empty.kind, 'opaque')
  assert.equal(empty.kind === 'opaque' && empty.text, null)
})

test('a testosterone sig with no recognisable schedule is opaque, not assumed weekly', () => {
  const dose = readDose({
    name: 'Testosterone cypionate',
    dosage: 'Inject .35mL subcutaneously as directed.',
  })

  assert.equal(dose.kind, 'opaque')
  assert.equal(dose.kind === 'opaque' && dose.text, 'Inject .35mL subcutaneously as directed.')
})

test('an opaque dose keeps the sig as written, for the provider to read', () => {
  const dose = readDose({ name: 'Tadalafil', dosage: '5mg tablet – 1 tablet PO daily as needed' })
  assert.equal(dose.kind === 'opaque' && dose.text, '5mg tablet – 1 tablet PO daily as needed')
})

test('a generated sig is written the way existing ones are, and names the Concentration', () => {
  assert.equal(
    injectionSig({ weeklyMg: 160, perWeek: 2, route: 'subcutaneously' }),
    'Inject .4mL subcutaneously every 3.5 days. 200mg/mL.'
  )

  assert.equal(
    injectionSig({ weeklyMg: 200, perWeek: 1, route: 'intramuscularly' }),
    'Inject 1mL intramuscularly once weekly on the same day every week. 200mg/mL.'
  )

  assert.equal(
    injectionSig({ weeklyMg: 160, perWeek: 3, route: 'subcutaneously' }),
    'Inject .267mL subcutaneously on MWF. 200mg/mL.'
  )

  assert.equal(
    injectionSig({ weeklyMg: 10, perWeek: 1, route: 'subcutaneously', concentration: 20 }),
    'Inject .5mL subcutaneously once weekly on the same day every week. 20mg/mL.'
  )
})

test('a generated sig reads back as the dose it was built from', () => {
  for (const weeklyMg of [100, 120, 140, 160, 180, 200, 250]) {
    for (const perWeek of [1, 2, 3, 3.5, 7]) {
      for (const route of ['subcutaneously', 'intramuscularly'] as const) {
        const sig = injectionSig({ weeklyMg, perWeek, route })
        const dose = readDose({ name: 'Testosterone cypionate', dosage: sig })

        assert.equal(dose.kind, 'injection', sig)
        if (dose.kind !== 'injection') continue

        assert.equal(dose.route, route, sig)
        assert.equal(dose.perWeek, perWeek, sig)
        // Exactly, in both directions: a schedule that does not divide evenly
        // leaves the volume a rounded one, and reading it back to the level is
        // what closes the loop.
        assert.equal(dose.weeklyMg, weeklyMg, sig)
      }
    }
  }
})

test('milligrams per week convert to a volume per injection', () => {
  assert.equal(mlPerDose(160, 2), 0.4)
  assert.equal(mlPerDose(200, 1), 1)
  assert.equal(mlPerDose(160, 0), 0)
})

test('a dose level is written one way', () => {
  assert.equal(weeklyMgLabel(160), '160mg/week')
  assert.equal(weeklyMgLabel(159.6), '160mg/week')
})

test('a male Patient starts on 200mg/mL and 160mg/week', () => {
  assert.deepEqual(startingDose({ gender: 'male', state: 'Texas' }), {
    concentration: 200,
    weeklyMg: 160,
    weeklyMgStep: 10,
    audience: 'male',
  })
  assert.deepEqual(offeredConcentrations({ gender: 'Male', state: 'Texas' }), [20, 50, 200])
})

test('blank or other gender is treated as male', () => {
  assert.equal(startingDose({ gender: null, state: 'California' }).concentration, 200)
  assert.equal(startingDose({ gender: 'other', state: 'Oregon' }).weeklyMg, 160)
  assert.equal(startingDose({ gender: 'other', state: 'Oregon' }).audience, 'male')
})

test('a female Patient starts on 20mg/mL and 10mg/week', () => {
  assert.deepEqual(startingDose({ gender: 'female', state: 'Texas' }), {
    concentration: 20,
    weeklyMg: 10,
    weeklyMgStep: 5,
    audience: 'female',
  })
  assert.deepEqual(offeredConcentrations({ gender: 'F', state: 'Texas' }), [20, 50, 200])
})

test('a California female starts on 50mg/mL only', () => {
  assert.deepEqual(startingDose({ gender: 'female', state: 'California' }), {
    concentration: 50,
    weeklyMg: 10,
    weeklyMgStep: 5,
    audience: 'california_female',
  })
  assert.deepEqual(offeredConcentrations({ gender: 'female', state: 'California' }), [50])
})

test('an existing Concentration stays offered even when gender would lock it out', () => {
  assert.deepEqual(
    offeredConcentrations({ gender: 'female', state: 'California', current: 200 }),
    [50, 200]
  )
})
