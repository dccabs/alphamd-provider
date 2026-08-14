import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ACTIVE_DISPOSITIONS,
  DISPOSITIONS,
  DISPOSITION_HINTS,
  DISPOSITION_LABELS,
  EMPTY_DRAFT,
  FOLLOW_UP_KINDS,
  FOLLOW_UP_LABELS,
  ONBOARDING_DISPOSITIONS,
  dispositionsFor,
  isDisposition,
  isDraftEmpty,
  parseDraft,
} from './reviewDraft.ts'

test('a null or non-object draft column reads as empty', () => {
  assert.deepEqual(parseDraft(null), EMPTY_DRAFT)
  assert.deepEqual(parseDraft(undefined), EMPTY_DRAFT)
  assert.deepEqual(parseDraft('nope'), EMPTY_DRAFT)
  assert.deepEqual(parseDraft(42), EMPTY_DRAFT)
})

test('a full draft round-trips', () => {
  const stored = {
    disposition: 'follow_up_needed',
    followUpKinds: ['more_labs', 'patient_instructions'],
    doseMedicationId: 4821,
    doseMedication: 'Testosterone Cypionate',
    doseFrom: '140mg/week',
    doseValue: '180mg/week',
    doseSig: 'Inject .45mL subcutaneously every 3.5 days.',
    instructions: 'Recheck in 8 weeks',
    newMedications: [
      {
        medicationId: 13,
        name: 'Anastrozole',
        dose: '1.00mg - Take 1/2 tablet (0.50mg) by mouth twice weekly.',
        sig: '',
      },
    ],
    concerns: 'Hct trending up',
    csInstructions: 'Book a phlebotomy',
    providerNote: 'Discussed with patient',
  }

  assert.deepEqual(parseDraft(stored), stored)
})

test('an unknown disposition is dropped rather than trusted', () => {
  assert.equal(parseDraft({ disposition: 'euthanize' }).disposition, null)
  assert.equal(parseDraft({ disposition: 42 }).disposition, null)
})

test('unknown follow-up kinds are filtered out', () => {
  assert.deepEqual(parseDraft({ followUpKinds: ['more_labs', 'nonsense'] }).followUpKinds, [
    'more_labs',
  ])
})

test('repeated follow-up kinds are deduplicated', () => {
  assert.deepEqual(
    parseDraft({ followUpKinds: ['more_labs', 'more_labs'] }).followUpKinds,
    ['more_labs']
  )
})

test('a non-array followUpKinds does not throw', () => {
  assert.deepEqual(parseDraft({ followUpKinds: 'more_labs' }).followUpKinds, [])
})

test('malformed medication rows are coerced, not dropped silently mid-array', () => {
  assert.deepEqual(
    parseDraft({ newMedications: [{ name: 'A' }, null, { dose: 5 }] }).newMedications,
    [
      { medicationId: null, name: 'A', dose: '', sig: '' },
      { medicationId: null, name: '', dose: '', sig: '' },
    ]
  )
})

test('a medication added before the catalog picker keeps its typed name and dose', () => {
  // What autosave stored when a new medication was two free-text inputs: no
  // catalog row behind the name, and no generated instruction.
  assert.deepEqual(
    parseDraft({ newMedications: [{ name: 'Vitamin D', dose: '5000 IU daily' }] }).newMedications,
    [{ medicationId: null, name: 'Vitamin D', dose: '5000 IU daily', sig: '' }]
  )
})

test('a catalog id on a medication is only kept if it could be a row id', () => {
  const ids = (medicationId: unknown) =>
    parseDraft({ newMedications: [{ name: 'A', medicationId }] }).newMedications[0].medicationId

  assert.equal(ids(13), 13)
  assert.equal(ids('13'), null)
  assert.equal(ids(0), null)
  assert.equal(ids(4.5), null)
})

test('a draft written before the medication list still reads', () => {
  // What autosave stored when the dose change was two free-text inputs.
  const draft = parseDraft({
    disposition: 'dose_change',
    doseMedication: 'Test Cyp',
    doseValue: '180 mg/wk',
  })

  assert.equal(draft.doseMedication, 'Test Cyp')
  assert.equal(draft.doseValue, '180 mg/wk')
  assert.equal(draft.doseMedicationId, null)
  assert.equal(draft.doseFrom, '')
  assert.equal(draft.doseSig, '')
})

test('a medication id is only kept if it could be a row id', () => {
  assert.equal(parseDraft({ doseMedicationId: 4821 }).doseMedicationId, 4821)
  assert.equal(parseDraft({ doseMedicationId: '4821' }).doseMedicationId, null)
  assert.equal(parseDraft({ doseMedicationId: 0 }).doseMedicationId, null)
  assert.equal(parseDraft({ doseMedicationId: -1 }).doseMedicationId, null)
  assert.equal(parseDraft({ doseMedicationId: 4.5 }).doseMedicationId, null)
})

test('non-string text fields fall back to empty', () => {
  const draft = parseDraft({ concerns: { a: 1 }, providerNote: 12 })
  assert.equal(draft.concerns, '')
  assert.equal(draft.providerNote, '')
})

test('the empty draft is empty', () => {
  assert.ok(isDraftEmpty(EMPTY_DRAFT))
})

test('any single filled field makes a draft worth saving', () => {
  assert.equal(isDraftEmpty({ ...EMPTY_DRAFT, concerns: 'x' }), false)
  assert.equal(isDraftEmpty({ ...EMPTY_DRAFT, disposition: 'continue_protocol' }), false)
  assert.equal(isDraftEmpty({ ...EMPTY_DRAFT, followUpKinds: ['more_labs'] }), false)
})

test('whitespace alone is not worth saving', () => {
  assert.ok(isDraftEmpty({ ...EMPTY_DRAFT, concerns: '   ', providerNote: '\n' }))
})

test('a blank medication row added and not filled in is not worth saving', () => {
  assert.ok(
    isDraftEmpty({
      ...EMPTY_DRAFT,
      newMedications: [{ medicationId: null, name: '', dose: '', sig: '' }],
    })
  )
})

test('an added medication is worth saving', () => {
  assert.equal(
    isDraftEmpty({
      ...EMPTY_DRAFT,
      newMedications: [
        { medicationId: 1, name: 'Testosterone cypionate', dose: '160mg/week', sig: '' },
      ],
    }),
    false
  )
})

test('every "Non-Patient" status gets the onboarding dispositions', () => {
  for (const status of [
    'Non-Patient - Registered',
    'Non-Patient - Test Results Received - Awaiting Review',
    'Non-Patient - Pricing sent to PT',
    'Non-Patient - Dropped',
  ]) {
    assert.deepEqual(dispositionsFor(status), ONBOARDING_DISPOSITIONS)
  }
})

test('subscribed patients get the active dispositions', () => {
  for (const status of [
    'Patient, Active Subscription',
    'Patient - Active Sub TRT + Weightloss',
    'Patient,  Subscription Paused',
    'Patient,  Subscription Cancelled',
  ]) {
    assert.deepEqual(dispositionsFor(status), ACTIVE_DISPOSITIONS)
  }
})

test('an unknown status is treated as onboarding, the safer default', () => {
  assert.deepEqual(dispositionsFor(null), ONBOARDING_DISPOSITIONS)
})

test('every disposition and follow-up kind has a label and hint', () => {
  for (const d of DISPOSITIONS) {
    assert.ok(DISPOSITION_LABELS[d].length > 0)
    assert.ok(DISPOSITION_HINTS[d].length > 0)
  }
  for (const k of FOLLOW_UP_KINDS) {
    assert.ok(FOLLOW_UP_LABELS[k].length > 0)
  }
})

test('the two disposition sets do not overlap', () => {
  const onboarding = new Set<string>(ONBOARDING_DISPOSITIONS)
  assert.ok(ACTIVE_DISPOSITIONS.every((d) => !onboarding.has(d)))
})

test('every disposition in either set is a recognised disposition', () => {
  for (const d of [...ONBOARDING_DISPOSITIONS, ...ACTIVE_DISPOSITIONS]) {
    assert.ok(isDisposition(d))
  }
})
