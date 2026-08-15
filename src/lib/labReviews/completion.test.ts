import assert from 'node:assert/strict'
import test from 'node:test'

import { FLAG, FLAG_LABELS, PATIENT_STATUS, PATIENT_STATUS_LABELS } from './clinicalIds.ts'
import { planCompletion, reviewAudiences, validateCompletion } from './completion.ts'
import {
  DISPOSITIONS,
  EMPTY_DRAFT,
  type DoseChange,
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

const change = (patch: Partial<DoseChange> = {}): DoseChange => ({
  medicationId: null,
  medication: '',
  from: '',
  value: '',
  sig: '',
  ...patch,
})

/** The dose change most of these tests are about: testosterone raised a level,
 *  with the sig the level works out to. */
const testosterone = change({
  medicationId: 4821,
  medication: 'Testosterone cypionate',
  from: '140mg/week',
  value: '160mg/week',
  sig: 'Inject .4mL subcutaneously every 3.5 days.',
})

test('a review with no disposition cannot be finished', () => {
  assert.deepEqual(validateCompletion(draft()), ['Choose a disposition before finishing.'])
})

test('continue protocol needs nothing else', () => {
  assert.deepEqual(validateCompletion(draft({ disposition: 'continue_protocol' })), [])
})

test('continue protocol cannot be finished with a medication added', () => {
  // Left behind by adding one and then landing on this disposition. The note it
  // would write would say nothing is changing and then prescribe something.
  const problems = validateCompletion(
    draft({
      disposition: 'continue_protocol',
      newMedications: [med({ name: 'Anastrozole', dose: '0.5mg twice weekly' })],
    })
  )
  assert.equal(problems.length, 1)
  assert.match(problems[0], /cannot also add a medication/)

  // A blank row is not an addition, so it holds nothing up.
  assert.deepEqual(
    validateCompletion(draft({ disposition: 'continue_protocol', newMedications: [med()] })),
    []
  )
})

test('a dose change must record at least one change', () => {
  assert.deepEqual(validateCompletion(draft({ disposition: 'dose_change' })), [
    'Record the dose change: choose a medication and set its new dose.',
  ])

  assert.deepEqual(
    validateCompletion(draft({ disposition: 'dose_change', doseChanges: [testosterone] })),
    []
  )
})

test('a half-recorded change does not satisfy a dose change', () => {
  // Either half alone describes nothing anyone downstream could act on.
  for (const half of [
    change({ medication: 'Test Cyp' }),
    change({ value: '180 mg/wk' }),
    change({ medication: '  ', value: '\t' }),
  ]) {
    assert.equal(
      validateCompletion(draft({ disposition: 'dose_change', doseChanges: [half] })).length,
      1
    )
  }
})

test('any number of dose changes satisfies the disposition', () => {
  assert.deepEqual(
    validateCompletion(
      draft({
        disposition: 'dose_change',
        doseChanges: [
          testosterone,
          change({ medicationId: 4822, medication: 'Anastrozole', value: '0.25mg twice weekly' }),
        ],
      })
    ),
    []
  )
})

test('a dose change under another disposition stops the review being finished', () => {
  // Recorded and then landed on a different disposition. The change stays in the
  // draft, so this is what makes the provider deal with it rather than have it
  // quietly dropped from the note.
  for (const disposition of ['continue_protocol', 'follow_up_needed'] as const) {
    const problems = validateCompletion(
      draft({ disposition, followUpKinds: ['more_labs'], doseChanges: [testosterone] })
    )
    assert.deepEqual(
      problems,
      ['A dose change is only recorded under the Dose change disposition. Remove it, or choose Dose change.'],
      disposition
    )
  }
})

test('a half-recorded change left under another disposition holds nothing up', () => {
  assert.deepEqual(
    validateCompletion(
      draft({ disposition: 'continue_protocol', doseChanges: [change({ medication: 'Test Cyp' })] })
    ),
    []
  )
})

test('a follow-up must say what it needs', () => {
  assert.deepEqual(validateCompletion(draft({ disposition: 'follow_up_needed' })), [
    'Say what the follow-up needs.',
  ])
})

test('ticking a specific patient message requires that message', () => {
  const problems = validateCompletion(
    draft({ disposition: 'follow_up_needed', followUpKinds: ['patient_instructions'] })
  )
  assert.deepEqual(problems, ['Write the message for the patient.'])

  assert.deepEqual(
    validateCompletion(
      draft({
        disposition: 'follow_up_needed',
        followUpKinds: ['patient_instructions'],
        patientMessage: 'Your next draw is in 8 weeks.',
      })
    ),
    []
  )
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
      draft({ disposition, doseChanges: [testosterone], followUpKinds: ['more_labs'] }),
      'Dr Smith'
    )
    assert.deepEqual(plan.removeFlagIds, [FLAG.needsLabReview], disposition)
  }
})

test('only continue-protocol claims no changes were recommended', () => {
  for (const disposition of DISPOSITIONS) {
    const plan = planCompletion(
      draft({ disposition, doseChanges: [testosterone], followUpKinds: ['more_labs'] }),
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
      draft({ disposition, doseChanges: [testosterone], followUpKinds: ['more_labs'] }),
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
      providerNote: 'Spoke with the patient.',
    }),
    'Dr Smith'
  )

  assert.match(plan.note, /Follow-up needed: Needs more labs, Add a new medication/)
  assert.match(plan.note, /New medication: Anastrozole — 0\.5 mg\./)
  assert.match(plan.note, /New medication: Vitamin D\./)
  assert.match(plan.note, /Spoke with the patient\./)
  assert.doesNotMatch(plan.note, /Message for the patient:/)
  assert.doesNotMatch(plan.note, /ignored/)
})

test('what the patient was told goes on the chart', () => {
  // The record has to show the result was communicated, not only that it was
  // read: an abnormal value nobody told the patient about is the claim.
  const plan = planCompletion(
    draft({
      disposition: 'dose_change',
      doseChanges: [testosterone],
      patientMessage: 'Your hematocrit is up, so we are lowering your dose.',
    }),
    'Dr Smith'
  )

  assert.match(
    plan.note,
    /Message for the patient: Your hematocrit is up, so we are lowering your dose\./
  )
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
      doseChanges: [testosterone],
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
    draft({ disposition: 'dose_change', doseChanges: [testosterone] }),
    'Dr Smith'
  )

  assert.match(
    plan.note,
    /Dose change: Testosterone cypionate — 160mg\/week \(was 140mg\/week\)\. Inject \.4mL subcutaneously every 3\.5 days\./
  )
})

test('two medications changed in one review each get their own line', () => {
  // ALP-2: a provider adjusting two prescriptions in one sitting. Both have to
  // survive to the chart and to whoever updates the prescriptions.
  const plan = planCompletion(
    draft({
      disposition: 'dose_change',
      doseChanges: [
        testosterone,
        change({
          medicationId: 4822,
          medication: 'Anastrozole',
          from: '0.5mg twice weekly',
          value: '0.25mg twice weekly',
        }),
      ],
    }),
    'Dr Smith'
  )

  assert.match(plan.note, /Dose change: Testosterone cypionate — 160mg\/week \(was 140mg\/week\)/)
  assert.match(plan.note, /Dose change: Anastrozole — 0\.25mg twice weekly \(was 0\.5mg twice weekly\)/)
  assert.match(plan.note, /For customer service: Dose change — Testosterone cypionate/)
  assert.match(plan.note, /Dose change — Anastrozole: 0\.5mg twice weekly → 0\.25mg twice weekly\./)

  // Confirmed first is written first, in both halves, so the note reads in the
  // order the decisions were made.
  const chart = plan.note.indexOf('Dose change: Testosterone')
  const chartSecond = plan.note.indexOf('Dose change: Anastrozole')
  assert.ok(chart < chartSecond && chart !== -1)
  assert.ok(
    plan.note.indexOf('Dose change — Testosterone') < plan.note.indexOf('Dose change — Anastrozole')
  )
})

test('a half-recorded change is left out of the note rather than half-written', () => {
  const plan = planCompletion(
    draft({
      disposition: 'dose_change',
      doseChanges: [testosterone, change({ medicationId: 4822, medication: 'Anastrozole' })],
    }),
    'Dr Smith'
  )

  assert.match(plan.note, /Dose change: Testosterone cypionate/)
  assert.doesNotMatch(plan.note, /Anastrozole/)
})

test('a dose change reaches customer service without being retyped', () => {
  const plan = planCompletion(
    draft({
      disposition: 'dose_change',
      doseChanges: [testosterone],
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
      doseChanges: [
        change({
          medicationId: 4821,
          medication: 'Testosterone cypionate',
          from: '160mg/week',
          value: '160mg/week',
          sig: 'Inject .4mL intramuscularly every 3.5 days.',
        }),
      ],
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
      doseChanges: [
        change({
          medicationId: 4822,
          medication: 'Anastrozole',
          from: '0.5mg - Take 1/2 tablet (0.50mg) by mouth twice weekly',
          value: '0.25mg twice weekly',
        }),
      ],
    }),
    'Dr Smith'
  )

  assert.match(plan.note, /Dose change: Anastrozole — 0\.25mg twice weekly \(was 0\.5mg/)
  assert.doesNotMatch(plan.note, /Inject/)
})

test('only a dose change puts a dose in the customer service block', () => {
  // Left behind by choosing dose change and then changing to continue. Finishing
  // is blocked while it is there, and if it somehow is not, the note must still
  // not contradict the disposition it was filed under.
  const plan = planCompletion(
    draft({ disposition: 'continue_protocol', doseChanges: [testosterone] }),
    'Dr Smith'
  )

  assert.doesNotMatch(plan.note, /Dose change/)
  assert.doesNotMatch(plan.note, /For customer service/)
  assert.deepEqual(plan.detail.doseChanges, [])
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
      draft({
        disposition: 'dose_change',
        doseChanges: [change({ medicationId: 4821, medication: 'Test Cyp', value: '180 mg/wk' })],
      }),
      'Dr Smith'
    ).resolution,
    'Dose change: Test Cyp — 180 mg/wk'
  )

  assert.equal(
    planCompletion(draft({ disposition: 'continue_protocol' }), 'Dr Smith').resolution,
    'Continue protocol as designed'
  )
})

test('resolution names every medication changed, since the queue shows only this line', () => {
  assert.equal(
    planCompletion(
      draft({
        disposition: 'dose_change',
        doseChanges: [
          testosterone,
          change({ medicationId: 4822, medication: 'Anastrozole', value: '0.25mg twice weekly' }),
        ],
      }),
      'Dr Smith'
    ).resolution,
    'Dose change: Testosterone cypionate — 160mg/week; Anastrozole — 0.25mg twice weekly'
  )
})

test('the detail keeps the prescription behind each dose change', () => {
  const plan = planCompletion(
    draft({
      disposition: 'dose_change',
      doseChanges: [
        testosterone,
        // Typed into an older draft, so there is no prescription row and no
        // dose to have changed from.
        change({ medication: 'Anastrozole', value: '0.25mg twice weekly' }),
      ],
    }),
    'Dr Smith'
  )

  assert.deepEqual(plan.detail.doseChanges, [
    {
      medicationId: 4821,
      medication: 'Testosterone cypionate',
      from: '140mg/week',
      value: '160mg/week',
      sig: 'Inject .4mL subcutaneously every 3.5 days.',
    },
    {
      medicationId: null,
      medication: 'Anastrozole',
      from: null,
      value: '0.25mg twice weekly',
      sig: null,
    },
  ])
})

test('the structured detail keeps blanks as null rather than empty strings', () => {
  const plan = planCompletion(draft({ disposition: 'continue_protocol' }), 'Dr Smith')
  assert.deepEqual(plan.detail.doseChanges, [])
  assert.equal(plan.detail.patientMessage, null)
  assert.equal(plan.detail.csInstructions, null)
  assert.deepEqual(plan.detail.newMedications, [])
  assert.equal(plan.detail.disposition, 'continue_protocol')
})

test('planning without a disposition throws rather than writing a half-record', () => {
  assert.throws(() => planCompletion(draft(), 'Dr Smith'), /validate first/)
})

/** Everything filled in, for the summary a provider approves. */
const full = draft({
  disposition: 'dose_change',
  doseChanges: [testosterone],
  newMedications: [med({ medicationId: 13, name: 'Anastrozole', dose: '0.5mg twice weekly' })],
  patientMessage: 'Hi Marcus,\n\nYour provider raised your dose.',
  csInstructions: 'Book the 8 week draw.',
  providerNote: 'Raised testosterone for symptom control.',
})

test('the patient sees exactly what was written for them', () => {
  const audiences = reviewAudiences(full, 'Dr Smith')
  assert.equal(audiences.patient, 'Hi Marcus,\n\nYour provider raised your dose.')
})

test('the customer service text is the same text the note carries', () => {
  // The whole point of composing this once. If the summary and the chart could
  // disagree, the thing they disagreed about would be a prescription.
  const audiences = reviewAudiences(full, 'Dr Smith')
  const note = planCompletion(full, 'Dr Smith').note

  assert.ok(audiences.customerService.length > 0)
  assert.ok(note.includes(`For customer service: ${audiences.customerService}`))
})

test('customer service is handed the changes before the provider’s own hand-off', () => {
  const audiences = reviewAudiences(full, 'Dr Smith')
  assert.deepEqual(audiences.customerService.split('\n'), [
    'Dose change — Testosterone cypionate: 140mg/week → 160mg/week. New sig: Inject .4mL subcutaneously every 3.5 days. Update the prescription and the next shipment.',
    'New medication — Anastrozole: 0.5mg twice weekly. Add it to the prescription and the next shipment.',
    'Book the 8 week draw.',
  ])
})

test('the chart text is the note, character for character', () => {
  assert.equal(reviewAudiences(full, 'Dr Smith').chart, planCompletion(full, 'Dr Smith').note)
})

test('the provider’s name reaches the summary, since the note opens with it', () => {
  assert.match(reviewAudiences(full, 'Dr Jane Smith').chart, /completed by Dr Jane Smith\./)
})

test('a review with nothing written leaves two of the three empty', () => {
  const audiences = reviewAudiences(draft({ disposition: 'continue_protocol' }), 'Dr Smith')
  assert.equal(audiences.patient, '')
  assert.equal(audiences.customerService, '')
  assert.match(audiences.chart, /Disposition: Continue protocol as designed\./)
})

test('every flag and status a completion can touch has a label to show', () => {
  // The confirmation screen names these. An id with no label would appear there
  // as a bare number, or as nothing at all.
  for (const disposition of DISPOSITIONS) {
    const plan = planCompletion(
      draft({ disposition, doseChanges: [testosterone], followUpKinds: ['more_labs'] }),
      'Dr Smith'
    )

    for (const id of [...plan.addFlagIds, ...plan.removeFlagIds]) {
      assert.ok(FLAG_LABELS[id], `flag ${id} (${disposition})`)
    }
    if (plan.patientStatusId !== null) {
      assert.ok(PATIENT_STATUS_LABELS[plan.patientStatusId], `status ${plan.patientStatusId}`)
    }
  }
})

test('a dose change alone still gives customer service something to do', () => {
  // Nothing was typed for them, but a prescription has to be updated.
  const audiences = reviewAudiences(
    draft({ disposition: 'dose_change', doseChanges: [testosterone] }),
    'Dr Smith'
  )
  assert.match(audiences.customerService, /Update the prescription and the next shipment\./)
})
