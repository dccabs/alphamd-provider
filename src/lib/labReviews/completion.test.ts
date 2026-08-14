import assert from 'node:assert/strict'
import test from 'node:test'

import { FLAG, PATIENT_STATUS } from './clinicalIds.ts'
import { planCompletion, validateCompletion } from './completion.ts'
import {
  DISPOSITIONS,
  EMPTY_DRAFT,
  type DraftMedication,
  type ReviewDraft,
} from './reviewDraft.ts'

const draft = (patch: Partial<ReviewDraft> = {}): ReviewDraft => ({ ...EMPTY_DRAFT, ...patch })

const med = (patch: Partial<DraftMedication> = {}): DraftMedication => ({
  medicationId: null,
  name: '',
  dose: '',
  sig: '',
  ...patch,
})

test('a review with no disposition cannot be finished', () => {
  assert.deepEqual(validateCompletion(draft()), ['Choose a disposition before finishing.'])
})

test('continue protocol needs nothing else', () => {
  assert.deepEqual(validateCompletion(draft({ disposition: 'continue_protocol' })), [])
})

test('a dose change must name the medication and the dose', () => {
  const problems = validateCompletion(draft({ disposition: 'dose_change' }))
  assert.equal(problems.length, 2)

  assert.deepEqual(
    validateCompletion(
      draft({ disposition: 'dose_change', doseMedication: 'Test Cyp', doseValue: '180 mg/wk' })
    ),
    []
  )
})

test('whitespace does not satisfy a dose change', () => {
  assert.equal(
    validateCompletion(
      draft({ disposition: 'dose_change', doseMedication: '  ', doseValue: '\t' })
    ).length,
    2
  )
})

test('a follow-up must say what it needs', () => {
  assert.deepEqual(validateCompletion(draft({ disposition: 'follow_up_needed' })), [
    'Say what the follow-up needs.',
  ])
})

test('ticking patient instructions requires the instructions', () => {
  const problems = validateCompletion(
    draft({ disposition: 'follow_up_needed', followUpKinds: ['patient_instructions'] })
  )
  assert.deepEqual(problems, ['Enter the instructions for the patient.'])
})

test('ticking add-a-medication requires a named medication', () => {
  const problems = validateCompletion(
    draft({
      disposition: 'follow_up_needed',
      followUpKinds: ['new_medication'],
      newMedications: [med({ name: '  ', dose: '5 mg' })],
    })
  )
  assert.equal(problems.length, 1)

  assert.deepEqual(
    validateCompletion(
      draft({
        disposition: 'follow_up_needed',
        followUpKinds: ['new_medication'],
        newMedications: [med({ medicationId: 13, name: 'Anastrozole' })],
      })
    ),
    []
  )
})

test('more-labs alone is a complete follow-up', () => {
  assert.deepEqual(
    validateCompletion(draft({ disposition: 'follow_up_needed', followUpKinds: ['more_labs'] })),
    []
  )
})

test('every disposition clears the "Needs lab review" flag', () => {
  for (const disposition of DISPOSITIONS) {
    const plan = planCompletion(
      draft({
        disposition,
        doseMedication: 'Test Cyp',
        doseValue: '180 mg/wk',
        followUpKinds: ['more_labs'],
      }),
      'Dr Smith'
    )
    assert.deepEqual(plan.removeFlagIds, [FLAG.needsLabReview], disposition)
  }
})

test('only continue-protocol claims no changes were recommended', () => {
  for (const disposition of DISPOSITIONS) {
    const plan = planCompletion(
      draft({
        disposition,
        doseMedication: 'Test Cyp',
        doseValue: '180 mg/wk',
        followUpKinds: ['more_labs'],
      }),
      'Dr Smith'
    )
    assert.equal(
      plan.addFlagIds.includes(FLAG.labsReviewedNoChanges),
      disposition === 'continue_protocol',
      disposition
    )
  }
})

test('dispositions that need downstream work raise the follow-up flag', () => {
  for (const disposition of ['dose_change', 'follow_up_needed', 'treatment_recommended'] as const) {
    const plan = planCompletion(
      draft({
        disposition,
        doseMedication: 'Test Cyp',
        doseValue: '180 mg/wk',
        followUpKinds: ['more_labs'],
      }),
      'Dr Smith'
    )
    assert.ok(plan.addFlagIds.includes(FLAG.followUpRequired), disposition)
  }
})

test('declining treatment moves the patient status', () => {
  const plan = planCompletion(draft({ disposition: 'treatment_not_recommended' }), 'Dr Smith')
  assert.equal(plan.patientStatusId, PATIENT_STATUS.treatmentNotRecommended)
})

test('recommending treatment does NOT claim pricing was sent', () => {
  // Status 25 is "Pricing sent to PT". Recommending treatment is not sending
  // pricing, and the pricing tool does not live in this app yet.
  const plan = planCompletion(draft({ disposition: 'treatment_recommended' }), 'Dr Smith')
  assert.equal(plan.patientStatusId, null)
})

test('continuing a protocol leaves the patient status alone', () => {
  const plan = planCompletion(draft({ disposition: 'continue_protocol' }), 'Dr Smith')
  assert.equal(plan.patientStatusId, null)
})

test('the note names the provider and the disposition', () => {
  const plan = planCompletion(draft({ disposition: 'continue_protocol' }), 'Dr Jane Smith')
  assert.equal(
    plan.note,
    'Lab review completed by Dr Jane Smith. Disposition: Continue protocol as designed.'
  )
})

test('the note carries every filled section, and no empty ones', () => {
  const plan = planCompletion(
    draft({
      disposition: 'follow_up_needed',
      followUpKinds: ['more_labs', 'new_medication'],
      newMedications: [
        med({ medicationId: 13, name: 'Anastrozole', dose: '0.5 mg' }),
        med({ name: 'Vitamin D' }),
        med({ name: '  ', dose: 'ignored' }),
      ],
      concerns: 'Hct trending up',
      providerNote: 'Spoke with the patient.',
    }),
    'Dr Smith'
  )

  assert.match(plan.note, /Follow-up needed: Needs more labs, Add a new medication/)
  assert.match(plan.note, /New medication: Anastrozole — 0\.5 mg\./)
  assert.match(plan.note, /New medication: Vitamin D\./)
  assert.match(plan.note, /Areas of concern: Hct trending up/)
  assert.match(plan.note, /Spoke with the patient\./)
  assert.doesNotMatch(plan.note, /Patient instructions:/)
  assert.doesNotMatch(plan.note, /ignored/)
})

test('an added medication carries its level and the instruction it works out to', () => {
  const plan = planCompletion(
    draft({
      disposition: 'follow_up_needed',
      followUpKinds: ['new_medication'],
      newMedications: [
        med({
          medicationId: 1,
          name: 'Testosterone cypionate',
          dose: '160mg/week',
          sig: 'Inject .4mL subcutaneously every 3.5 days.',
        }),
      ],
    }),
    'Dr Smith'
  )

  assert.match(
    plan.note,
    /New medication: Testosterone cypionate — 160mg\/week\. Inject \.4mL subcutaneously every 3\.5 days\./
  )
  assert.match(
    plan.note,
    /For customer service: New medication — Testosterone cypionate: 160mg\/week\. Sig: Inject \.4mL subcutaneously every 3\.5 days\. Add it to the prescription and the next shipment\./
  )
})

test('a dose change and an added medication both reach customer service', () => {
  // The pair this section exists for: one visit, two things for somebody to do.
  const plan = planCompletion(
    draft({
      disposition: 'dose_change',
      doseMedication: 'Testosterone cypionate',
      doseFrom: '140mg/week',
      doseValue: '160mg/week',
      doseSig: 'Inject .4mL subcutaneously every 3.5 days.',
      newMedications: [
        med({
          medicationId: 13,
          name: 'Anastrozole',
          dose: '1.00mg - Take 1/2 tablet (0.50mg) by mouth twice weekly.',
        }),
      ],
    }),
    'Dr Smith'
  )

  assert.match(plan.note, /Dose change: Testosterone cypionate — 160mg\/week \(was 140mg\/week\)/)
  assert.match(plan.note, /New medication: Anastrozole — 1\.00mg - Take 1\/2 tablet/)
  assert.match(plan.note, /For customer service: Dose change — Testosterone cypionate/)
  assert.match(plan.note, /New medication — Anastrozole: 1\.00mg - Take 1\/2 tablet/)
})

test('a catalog dose that is already a sentence is not punctuated twice', () => {
  const plan = planCompletion(
    draft({
      disposition: 'follow_up_needed',
      followUpKinds: ['new_medication'],
      newMedications: [
        med({ medicationId: 15, name: 'Tadalafil', dose: 'Take 1 tablet by mouth daily.' }),
      ],
    }),
    'Dr Smith'
  )

  assert.doesNotMatch(plan.note, /daily\.\./)
})

test('the detail keeps the catalog row and the sig behind each added medication', () => {
  const plan = planCompletion(
    draft({
      disposition: 'follow_up_needed',
      followUpKinds: ['new_medication'],
      newMedications: [
        med({
          medicationId: 1,
          name: 'Testosterone cypionate',
          dose: '160mg/week',
          sig: 'Inject .4mL subcutaneously every 3.5 days.',
        }),
        med({ name: 'Vitamin D', dose: '5000 IU daily' }),
      ],
    }),
    'Dr Smith'
  )

  assert.deepEqual(plan.detail.newMedications, [
    {
      medicationId: 1,
      name: 'Testosterone cypionate',
      dose: '160mg/week',
      sig: 'Inject .4mL subcutaneously every 3.5 days.',
    },
    // Typed into an older draft, so there is no catalog row and no instruction.
    { medicationId: null, name: 'Vitamin D', dose: '5000 IU daily', sig: null },
  ])
})

test('the note says what the dose changed from, not only what it is now', () => {
  const plan = planCompletion(
    draft({
      disposition: 'dose_change',
      doseMedication: 'Testosterone cypionate',
      doseFrom: '140mg/week',
      doseValue: '160mg/week',
      doseSig: 'Inject .4mL subcutaneously every 3.5 days.',
    }),
    'Dr Smith'
  )

  assert.match(
    plan.note,
    /Dose change: Testosterone cypionate — 160mg\/week \(was 140mg\/week\)\. Inject \.4mL subcutaneously every 3\.5 days\./
  )
})

test('a dose change reaches customer service without being retyped', () => {
  const plan = planCompletion(
    draft({
      disposition: 'dose_change',
      doseMedication: 'Testosterone cypionate',
      doseFrom: '140mg/week',
      doseValue: '160mg/week',
      doseSig: 'Inject .4mL subcutaneously every 3.5 days.',
      csInstructions: 'Also book a phlebotomy',
    }),
    'Dr Smith'
  )

  assert.match(
    plan.note,
    /For customer service: Dose change — Testosterone cypionate: 140mg\/week → 160mg\/week\./
  )
  assert.match(plan.note, /Update the prescription and the next shipment\./)
  // What the provider typed survives alongside it.
  assert.match(plan.note, /Also book a phlebotomy/)
})

test('changing only the route does not read as an error in the note', () => {
  const plan = planCompletion(
    draft({
      disposition: 'dose_change',
      doseMedication: 'Testosterone cypionate',
      doseFrom: '160mg/week',
      doseValue: '160mg/week',
      doseSig: 'Inject .4mL intramuscularly every 3.5 days.',
    }),
    'Dr Smith'
  )

  assert.match(
    plan.note,
    /Dose change: Testosterone cypionate — 160mg\/week\. Inject \.4mL intramuscularly every 3\.5 days\./
  )
  assert.doesNotMatch(plan.note, /was 160mg\/week/)
  assert.match(plan.note, /For customer service: Dose change — Testosterone cypionate: 160mg\/week\./)
})

test('a dose typed as free text carries no generated instruction', () => {
  const plan = planCompletion(
    draft({
      disposition: 'dose_change',
      doseMedication: 'Anastrozole',
      doseFrom: '0.5mg - Take 1/2 tablet (0.50mg) by mouth twice weekly',
      doseValue: '0.25mg twice weekly',
    }),
    'Dr Smith'
  )

  assert.match(plan.note, /Dose change: Anastrozole — 0\.25mg twice weekly \(was 0\.5mg/)
  assert.doesNotMatch(plan.note, /Inject/)
})

test('only a dose change puts a dose in the customer service block', () => {
  const plan = planCompletion(
    draft({
      disposition: 'continue_protocol',
      // Left behind by choosing dose change and then changing to continue.
      doseMedication: 'Testosterone cypionate',
      doseValue: '160mg/week',
    }),
    'Dr Smith'
  )

  assert.doesNotMatch(plan.note, /Dose change/)
  assert.doesNotMatch(plan.note, /For customer service/)
})

test('the note is plain text — provider input is never wrapped in markup', () => {
  const plan = planCompletion(
    draft({
      disposition: 'continue_protocol',
      providerNote: '<script>alert(1)</script> & "quotes"',
    }),
    'Dr Smith'
  )

  // Stored verbatim, because the column is read as text. The guarantee that
  // matters is that this function adds no markup of its own.
  assert.match(plan.note, /<script>alert\(1\)<\/script> & "quotes"/)
  assert.doesNotMatch(plan.note, /<(p|br|div|strong)\b/)
})

test('resolution stays one line even for a multi-line provider note', () => {
  const plan = planCompletion(
    draft({ disposition: 'continue_protocol', providerNote: 'First line\nSecond line' }),
    'Dr Smith'
  )
  assert.equal(plan.resolution, 'Continue protocol as designed: First line')
})

test('resolution leads with the most specific detail available', () => {
  assert.equal(
    planCompletion(
      draft({ disposition: 'dose_change', doseMedication: 'Test Cyp', doseValue: '180 mg/wk' }),
      'Dr Smith'
    ).resolution,
    'Dose change: Test Cyp — 180 mg/wk'
  )

  assert.equal(
    planCompletion(draft({ disposition: 'continue_protocol' }), 'Dr Smith').resolution,
    'Continue protocol as designed'
  )
})

test('the structured detail keeps blanks as null rather than empty strings', () => {
  const plan = planCompletion(draft({ disposition: 'continue_protocol' }), 'Dr Smith')
  assert.equal(plan.detail.doseMedication, null)
  assert.equal(plan.detail.concerns, null)
  assert.deepEqual(plan.detail.newMedications, [])
  assert.equal(plan.detail.disposition, 'continue_protocol')
})

test('planning without a disposition throws rather than writing a half-record', () => {
  assert.throws(() => planCompletion(draft(), 'Dr Smith'), /validate first/)
})
