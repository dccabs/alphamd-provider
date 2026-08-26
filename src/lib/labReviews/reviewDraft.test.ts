import assert from 'node:assert/strict'
import test from 'node:test'

import { EMPTY_ORDER } from '../labOrders/order.ts'
import {
  ACTIVE_DISPOSITIONS,
  DISPOSITIONS,
  DISPOSITION_HINTS,
  DISPOSITION_LABELS,
  EMPTY_DRAFT,
  ONBOARDING_DISPOSITIONS,
  dispositionHint,
  dispositionsFor,
  isDisposition,
  isDraftEmpty,
  parseDraft,
  workflowFor,
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
    doseChanges: [
      {
        medicationId: 4821,
        medication: 'Testosterone Cypionate',
        from: '140mg/week',
        value: '180mg/week',
        sig: 'Inject .45mL subcutaneously every 3.5 days.',
      },
    ],
    patientMessage: 'Your next draw is in 8 weeks.',
    newMedications: [
      {
        medicationId: 13,
        name: 'Anastrozole',
        dose: '1.00mg - Take 1/2 tablet (0.50mg) by mouth twice weekly.',
        sig: '',
        dosageMg: null,
      },
    ],
    labOrders: [
      {
        timing: 'in_8_weeks',
        customDate: '',
        providerId: 'provider-uuid',
        testCodes: ['cbc_85025', 'testosterone_total_84403'],
        requiredCodes: ['cbc_85025'],
        compedCodes: [],
        diagnosisCodes: ['E29.1'],
      },
    ],
    consultation: {
      eventTypeId: '2d7a15dd-4c53-479b-b8ff-d26c508f4995',
      message: 'Want to talk through the hematocrit first.',
      bookingUrl: 'https://calendly.com/d/abc-def-ghi',
      expiresAt: '2026-11-14T00:00:00Z',
    },
    csInstructions: 'Book a phlebotomy',
    providerNote: 'Discussed with patient',
    chartSummary: 'Follow-up needed. New medications were added and the patient was emailed.',
    skippedSteps: ['doseChanges'],
    selectedDiscountIds: [1, 6],
    couponCode: 'SWITCH2026',
    discountsSeeded: true,
  }

  assert.deepEqual(parseDraft(stored), stored)
})

test('a draft saved before discounts existed reads as unseeded with none chosen', () => {
  const draft = parseDraft({ disposition: 'treatment_recommended' })
  assert.deepEqual(draft.selectedDiscountIds, [])
  assert.equal(draft.couponCode, null)
  assert.equal(draft.discountsSeeded, false)
})

test('junk discount ids are dropped so a malformed column cannot price a fake catalog row', () => {
  const draft = parseDraft({
    selectedDiscountIds: [6, 0, -1, 6, 1.5, '8', null, 1],
    couponCode: '  ',
    discountsSeeded: 'yes',
  })
  assert.deepEqual(draft.selectedDiscountIds, [6, 1])
  assert.equal(draft.couponCode, null)
  assert.equal(draft.discountsSeeded, false)
})

test('a skipped step survives the round trip, so a resumed review is not re-asked', () => {
  const draft = parseDraft({ disposition: 'dose_change', skippedSteps: ['labOrders', 'consultation'] })
  assert.deepEqual(draft.skippedSteps, ['labOrders', 'consultation'])
})

test('a step this build no longer knows about cannot settle anything', () => {
  const draft = parseDraft({ skippedSteps: ['labOrders', 'concerns', 7, null] })
  assert.deepEqual(draft.skippedSteps, ['labOrders'])
})

test('a draft saved before the flyout was stepped has no skips', () => {
  assert.deepEqual(parseDraft({ disposition: 'dose_change' }).skippedSteps, [])
  assert.deepEqual(parseDraft({ skippedSteps: 'labOrders' }).skippedSteps, [])
})

test('a skip alone cannot happen without a disposition, so emptiness ignores it', () => {
  // No step is offered until a disposition is chosen, so this shape is unreachable
  // from the UI. Pinned anyway: were it to occur, the draft would still be treated
  // as empty rather than saved as a row that records nothing.
  assert.ok(isDraftEmpty(parseDraft({ skippedSteps: ['labOrders'] })))
  assert.ok(!isDraftEmpty(parseDraft({ disposition: 'dose_change', skippedSteps: ['labOrders'] })))
})

test('a consultation staged before links were minted keeps its type and no link', () => {
  const draft = parseDraft({ consultation: { eventTypeId: 'f2d57860-5ffa-4439-b0c3-a5505fd60bb2' } })
  assert.deepEqual(draft.consultation, {
    eventTypeId: 'f2d57860-5ffa-4439-b0c3-a5505fd60bb2',
    message: '',
    bookingUrl: '',
    expiresAt: null,
  })
})

test('a consultation with no event type is not a staged consultation', () => {
  assert.equal(parseDraft({ consultation: { message: 'Please book in.' } }).consultation, null)
  assert.equal(parseDraft({ consultation: 'yes' }).consultation, null)
  assert.equal(parseDraft({}).consultation, null)
})

test('a draft written when the patient message was called instructions still reads', () => {
  const draft = parseDraft({ instructions: 'Start the new dose with your next shipment.' })
  assert.equal(draft.patientMessage, 'Start the new dose with your next shipment.')
})

test('the new patient message key wins over the old one', () => {
  // Both at once can only come from a hand-edited payload, and the key this
  // build writes is the one it should trust.
  const draft = parseDraft({ patientMessage: 'current', instructions: 'stale' })
  assert.equal(draft.patientMessage, 'current')
})

test('areas of concern from a retired box is kept on the chart note', () => {
  // Live in production when the box was cut. It is clinical reasoning in the
  // provider's own words, so dropping it would lose work nobody could recover.
  const draft = parseDraft({
    providerNote: 'Lowered testosterone for the rising hematocrit.',
    concerns: 'Hct 52.4, up from 49.1.',
  })

  assert.equal(
    draft.providerNote,
    'Lowered testosterone for the rising hematocrit.\n\nHct 52.4, up from 49.1.'
  )
  assert.ok(!('concerns' in draft))
})

test('concerns with no chart note becomes the chart note', () => {
  assert.equal(parseDraft({ concerns: 'Hct 52.4.' }).providerNote, 'Hct 52.4.')
})

test('an empty concerns key does not pad the chart note', () => {
  assert.equal(parseDraft({ providerNote: 'Stable.', concerns: '   ' }).providerNote, 'Stable.')
  assert.equal(parseDraft({ providerNote: 'Stable.' }).providerNote, 'Stable.')
})

test('an unknown disposition is dropped rather than trusted', () => {
  assert.equal(parseDraft({ disposition: 'euthanize' }).disposition, null)
  assert.equal(parseDraft({ disposition: 42 }).disposition, null)
})

test('the retired follow-up checkboxes are dropped without taking the draft with them', () => {
  // Four drafts were open in production with these ticked. Everything they
  // asserted is recorded in a field of its own — the medication that was added,
  // the message that was written — so the checkbox is the only thing lost.
  const draft = parseDraft({
    disposition: 'follow_up_needed',
    followUpKinds: ['more_labs', 'new_medication'],
    newMedications: [{ medicationId: 13, name: 'Anastrozole', dose: '0.5mg twice weekly' }],
    csInstructions: 'Update the next shipment.',
  })

  assert.ok(!('followUpKinds' in draft))
  assert.equal(draft.disposition, 'follow_up_needed')
  assert.equal(draft.newMedications.length, 1)
  assert.equal(draft.csInstructions, 'Update the next shipment.')
})

test('malformed medication rows are coerced, not dropped silently mid-array', () => {
  assert.deepEqual(
    parseDraft({ newMedications: [{ name: 'A' }, null, { dose: 5 }] }).newMedications,
    [
      { medicationId: null, name: 'A', dose: '', sig: '', dosageMg: null },
      { medicationId: null, name: '', dose: '', sig: '', dosageMg: null },
    ]
  )
})

test('a dose figure is only kept if it could be a dose', () => {
  const mg = (dosageMg: unknown) =>
    parseDraft({ newMedications: [{ name: 'A', dosageMg }] }).newMedications[0].dosageMg

  assert.equal(mg(160), 160)
  // Fractional doses are real — 12.5mg of enclomiphene — so this is not rounded
  // or rejected the way a row id is.
  assert.equal(mg(12.5), 12.5)
  assert.equal(mg('160'), null)
  assert.equal(mg(0), null)
  assert.equal(mg(-160), null)
  assert.equal(mg(Number.NaN), null)
  assert.equal(mg(Number.POSITIVE_INFINITY), null)
})

test('a medication added before the catalog picker keeps its typed name and dose', () => {
  // What autosave stored when a new medication was two free-text inputs: no
  // catalog row behind the name, no generated instruction, and no figure a
  // protocol could be priced on.
  assert.deepEqual(
    parseDraft({ newMedications: [{ name: 'Vitamin D', dose: '5000 IU daily' }] }).newMedications,
    [{ medicationId: null, name: 'Vitamin D', dose: '5000 IU daily', sig: '', dosageMg: null }]
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

  assert.deepEqual(draft.doseChanges, [
    { medicationId: null, medication: 'Test Cyp', from: '', value: '180 mg/wk', sig: '' },
  ])
})

test('a draft that held one dose change reads back as a list of one', () => {
  // A draft autosaved before more than one change could be recorded. This is
  // live in production, sig and all, so losing it would cost real work.
  const draft = parseDraft({
    disposition: 'dose_change',
    doseMedicationId: 6869,
    doseMedication: 'Testosterone cypionate',
    doseFrom: '160mg/week',
    doseValue: '140mg/week',
    doseSig: 'Inject .233mL subcutaneously on MWF.',
  })

  assert.deepEqual(draft.doseChanges, [
    {
      medicationId: 6869,
      medication: 'Testosterone cypionate',
      from: '160mg/week',
      value: '140mg/week',
      sig: 'Inject .233mL subcutaneously on MWF.',
    },
  ])
})

test('the old dose keys are ignored once the array is there', () => {
  // Both shapes at once can only come from a hand-edited payload. The array is
  // what this build writes, so it wins rather than being merged with.
  const draft = parseDraft({
    doseChanges: [{ medicationId: 1, medication: 'Anastrozole', value: '0.25mg twice weekly' }],
    doseMedication: 'Testosterone cypionate',
    doseValue: '140mg/week',
  })

  assert.deepEqual(draft.doseChanges, [
    { medicationId: 1, medication: 'Anastrozole', from: '', value: '0.25mg twice weekly', sig: '' },
  ])
})

test('an empty pair of old dose keys does not invent a change', () => {
  assert.deepEqual(parseDraft({ doseMedication: '', doseValue: '' }).doseChanges, [])
  assert.deepEqual(parseDraft({ doseMedication: '  ', doseValue: '\t' }).doseChanges, [])
  assert.deepEqual(parseDraft({ disposition: 'dose_change' }).doseChanges, [])
})

test('malformed dose change rows are coerced, not dropped silently mid-array', () => {
  assert.deepEqual(
    parseDraft({ doseChanges: [{ medication: 'A' }, null, { value: 5 }, 'nope'] }).doseChanges,
    [
      { medicationId: null, medication: 'A', from: '', value: '', sig: '' },
      { medicationId: null, medication: '', from: '', value: '', sig: '' },
    ]
  )
})

test('a prescription id on a dose change is only kept if it could be a row id', () => {
  const ids = (medicationId: unknown) =>
    parseDraft({ doseChanges: [{ medication: 'A', medicationId }] }).doseChanges[0].medicationId

  assert.equal(ids(4821), 4821)
  assert.equal(ids('4821'), null)
  assert.equal(ids(0), null)
  assert.equal(ids(-1), null)
  assert.equal(ids(4.5), null)
})

test('non-string text fields fall back to empty', () => {
  const draft = parseDraft({ patientMessage: { a: 1 }, providerNote: 12, concerns: [], chartSummary: 4 })
  assert.equal(draft.patientMessage, '')
  assert.equal(draft.providerNote, '')
  assert.equal(draft.chartSummary, '')
})

test('a saved chart summary survives the round trip', () => {
  assert.equal(
    parseDraft({ chartSummary: 'New medications added; patient emailed.' }).chartSummary,
    'New medications added; patient emailed.'
  )
})

test('a chart summary alone is not worth saving', () => {
  // It is generated from the other fields. Keeping a leftover summary would
  // make an otherwise empty draft look like work.
  assert.ok(isDraftEmpty({ ...EMPTY_DRAFT, chartSummary: 'Something happened.' }))
})

test('the empty draft is empty', () => {
  assert.ok(isDraftEmpty(EMPTY_DRAFT))
})

test('any single filled field makes a draft worth saving', () => {
  assert.equal(isDraftEmpty({ ...EMPTY_DRAFT, patientMessage: 'x' }), false)
  assert.equal(isDraftEmpty({ ...EMPTY_DRAFT, csInstructions: 'x' }), false)
  assert.equal(isDraftEmpty({ ...EMPTY_DRAFT, providerNote: 'x' }), false)
  assert.equal(isDraftEmpty({ ...EMPTY_DRAFT, disposition: 'continue_protocol' }), false)
})

test('an attached lab order is worth saving', () => {
  assert.equal(isDraftEmpty({ ...EMPTY_DRAFT, labOrders: [EMPTY_ORDER] }), false)
})

test('a staged consultation is worth saving', () => {
  const consultation = {
    eventTypeId: '2d7a15dd-4c53-479b-b8ff-d26c508f4995',
    message: '',
    bookingUrl: 'https://calendly.com/d/abc-def-ghi',
    expiresAt: null,
  }
  assert.equal(isDraftEmpty({ ...EMPTY_DRAFT, consultation }), false)
})

test('whitespace alone is not worth saving', () => {
  assert.ok(isDraftEmpty({ ...EMPTY_DRAFT, patientMessage: '   ', providerNote: '\n' }))
})

test('a blank medication row added and not filled in is not worth saving', () => {
  assert.ok(
    isDraftEmpty({
      ...EMPTY_DRAFT,
      newMedications: [{ medicationId: null, name: '', dose: '', sig: '', dosageMg: null }],
    })
  )
})

test('a dose change is worth saving', () => {
  assert.equal(
    isDraftEmpty({
      ...EMPTY_DRAFT,
      doseChanges: [
        {
          medicationId: 4821,
          medication: 'Testosterone cypionate',
          from: '160mg/week',
          value: '140mg/week',
          sig: '',
        },
      ],
    }),
    false
  )
})

test('an added medication is worth saving', () => {
  assert.equal(
    isDraftEmpty({
      ...EMPTY_DRAFT,
      newMedications: [
        {
          medicationId: 1,
          name: 'Testosterone cypionate',
          dose: '160mg/week',
          sig: '',
          dosageMg: 160,
        },
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

test('every disposition has a label and hint', () => {
  for (const d of DISPOSITIONS) {
    assert.ok(DISPOSITION_LABELS[d].length > 0)
    assert.ok(DISPOSITION_HINTS[d].length > 0)
  }
})

test('onboarding offers follow-up needed after the two treatment decisions', () => {
  assert.deepEqual(ONBOARDING_DISPOSITIONS, [
    'treatment_recommended',
    'treatment_not_recommended',
    'follow_up_needed',
  ])
})

test('the two disposition sets share only follow-up needed', () => {
  const shared = ONBOARDING_DISPOSITIONS.filter((d) =>
    (ACTIVE_DISPOSITIONS as readonly string[]).includes(d)
  )
  assert.deepEqual(shared, ['follow_up_needed'])
})

test('an onboarding follow-up does not mention adding a medication', () => {
  assert.equal(
    dispositionHint('follow_up_needed', 'Non-Patient - Test Results Received - Awaiting Review'),
    'More labs, a consultation, or a message for the patient'
  )
  assert.equal(
    dispositionHint('follow_up_needed', 'Patient, Active Subscription'),
    'More labs, a new medication, or a message for the patient'
  )
})

test('a missing status is onboarding, the safer default', () => {
  assert.equal(workflowFor(null), 'onboarding')
  assert.equal(workflowFor('Patient, Active Subscription'), 'member')
})

test('every disposition in either set is a recognised disposition', () => {
  for (const d of [...ONBOARDING_DISPOSITIONS, ...ACTIVE_DISPOSITIONS]) {
    assert.ok(isDisposition(d))
  }
})
