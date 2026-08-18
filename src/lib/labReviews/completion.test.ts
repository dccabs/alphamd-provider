import assert from 'node:assert/strict'
import test from 'node:test'

import type { ConsultRequest } from '../consultations/request.ts'
import { EMPTY_ORDER, type LabOrder } from '../labOrders/order.ts'
import { FLAG, FLAG_LABELS, PATIENT_STATUS, PATIENT_STATUS_LABELS } from './clinicalIds.ts'
import {
  planCompletion,
  reviewAudiences,
  validateCompletion,
  type ProtocolOutcome,
} from './completion.ts'
import {
  DISPOSITIONS,
  EMPTY_DRAFT,
  type DoseChange,
  type DraftMedication,
  type ReviewDraft,
} from './reviewDraft.ts'

const draft = (patch: Partial<ReviewDraft> = {}): ReviewDraft => ({ ...EMPTY_DRAFT, ...patch })

/** A complete order, dated now so every assertion about it is deterministic. */
const labs = (patch: Partial<LabOrder> = {}): LabOrder => ({
  ...EMPTY_ORDER,
  providerId: 'provider-uuid',
  testCodes: ['cbc_85025'],
  diagnosisCodes: ['E29.1'],
  ...patch,
})

/** A real Calendly event type, so `consultLine` resolves it. */
const FOLLOW_UP = '2d7a15dd-4c53-479b-b8ff-d26c508f4995'

const BOOKING_URL = 'https://calendly.com/d/abc-def-ghi'

const consult = (patch: Partial<ConsultRequest> = {}): ConsultRequest => ({
  eventTypeId: FOLLOW_UP,
  message: '',
  bookingUrl: BOOKING_URL,
  expiresAt: null,
  ...patch,
})

const med = (patch: Partial<DraftMedication> = {}): DraftMedication => ({
  medicationId: null,
  name: '',
  dose: '',
  sig: '',
  dosageMg: null,
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
      draft({ disposition, labOrders: [labs()], doseChanges: [testosterone] })
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

test('a follow-up with nothing recorded cannot be finished', () => {
  const problems = validateCompletion(draft({ disposition: 'follow_up_needed' }))
  assert.equal(problems.length, 1)
  assert.match(problems[0], /Say what the follow-up is/)
})

test('any one recorded thing is enough of a follow-up', () => {
  // The checkbox group this replaces asked the provider to declare what the
  // follow-up needed, next to the panels where they do it. Checking the recorded
  // thing instead means the two can no longer disagree.
  const each: Partial<ReviewDraft>[] = [
    { patientMessage: 'Your next draw is in 8 weeks.' },
    { csInstructions: 'Book the draw.' },
    { labOrders: [labs()] },
    { consultation: consult() },
    { newMedications: [med({ medicationId: 13, name: 'Anastrozole' })] },
  ]

  for (const patch of each) {
    assert.deepEqual(
      validateCompletion(draft({ disposition: 'follow_up_needed', ...patch })),
      [],
      JSON.stringify(patch)
    )
  }
})

test('an unnamed medication is not a follow-up on its own', () => {
  const problems = validateCompletion(
    draft({ disposition: 'follow_up_needed', newMedications: [med({ name: '  ', dose: '5 mg' })] })
  )
  assert.equal(problems.length, 1)
})

test('a lab order missing what a requisition needs is named rather than placed', () => {
  // Only reachable from a draft saved by an older build: the dialog will not
  // attach one. A requisition with no tests on it would be sent and be useless.
  const problems = validateCompletion(
    draft({
      disposition: 'continue_protocol',
      labOrders: [labs(), labs({ testCodes: [], providerId: '' })],
    })
  )

  assert.equal(problems.length, 2)
  assert.ok(problems.every((p) => p.startsWith('Lab order 2:')))
})

test('a consultation type that no longer exists is named rather than invited to', () => {
  // Only reachable from a draft saved before the type was retired. Sending a link
  // for it would mint one Calendly cannot honour.
  const problems = validateCompletion(
    draft({ disposition: 'continue_protocol', consultation: consult({ eventTypeId: 'gone' }) })
  )

  assert.equal(problems.length, 1)
  assert.match(problems[0], /no longer offered/)
})

test('a consultation can be requested under any disposition', () => {
  for (const disposition of DISPOSITIONS) {
    assert.deepEqual(
      validateCompletion(
        draft({
          disposition,
          doseChanges: disposition === 'dose_change' ? [testosterone] : [],
          consultation: consult(),
        })
      ),
      [],
      disposition
    )
  }
})

test('labs can be ordered under any disposition', () => {
  // Continuing a protocol as designed still means labs on an interval, and that
  // is the disposition most reviews land on.
  for (const disposition of DISPOSITIONS) {
    assert.deepEqual(
      validateCompletion(
        draft({
          disposition,
          doseChanges: disposition === 'dose_change' ? [testosterone] : [],
          labOrders: [labs({ timing: 'in_12_weeks' })],
        })
      ),
      [],
      disposition
    )
  }
})

test('every disposition clears the "Needs lab review" flag', () => {
  for (const disposition of DISPOSITIONS) {
    const plan = planCompletion(
      draft({ disposition, doseChanges: [testosterone], labOrders: [labs()] }),
      'Dr Smith'
    )
    assert.deepEqual(plan.removeFlagIds, [FLAG.needsLabReview], disposition)
  }
})

test('only continue-protocol claims no changes were recommended', () => {
  for (const disposition of DISPOSITIONS) {
    const plan = planCompletion(
      draft({ disposition, doseChanges: [testosterone], labOrders: [labs()] }),
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
      draft({ disposition, doseChanges: [testosterone], labOrders: [labs()] }),
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
      newMedications: [
        med({ medicationId: 13, name: 'Anastrozole', dose: '0.5 mg' }),
        med({ name: 'Vitamin D' }),
        med({ name: '  ', dose: 'ignored' }),
      ],
      providerNote: 'Spoke with the patient.',
    }),
    'Dr Smith'
  )

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
      newMedications: [
        med({
          medicationId: 1,
          name: 'Testosterone cypionate',
          dose: '160mg/week',
          sig: 'Inject .4mL subcutaneously every 3.5 days.',
          dosageMg: 160,
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
      // The figure the quote is priced on, kept beside the string it is displayed as.
      dosageMg: 160,
    },
    // Typed into an older draft, so there is no catalog row, no instruction and no
    // figure to price against.
    { medicationId: null, name: 'Vitamin D', dose: '5000 IU daily', sig: null, dosageMg: null },
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
  assert.deepEqual(plan.detail.labOrders, [])
  assert.equal(plan.detail.consultation, null)
  assert.equal(plan.detail.disposition, 'continue_protocol')
})

test('a requested consultation reaches the chart, the hand-off and the record', () => {
  const plan = planCompletion(
    draft({
      disposition: 'follow_up_needed',
      consultation: consult({ message: 'Want to talk through the hematocrit first.' }),
    }),
    'Dr Smith'
  )

  assert.match(
    plan.note,
    /Consultation requested: AlphaMD Provider, Secondary Follow-Up · 15 minutes/
  )
  // Customer service does not arrange it, but they are who the patient asks why
  // a booking link arrived.
  assert.match(plan.note, /For customer service: Consultation — the patient is emailed a booking link/)
  assert.match(plan.note, /They book it themselves\./)
  assert.deepEqual(plan.detail.consultation, {
    eventTypeId: FOLLOW_UP,
    eventTypeName: 'AlphaMD Provider, Secondary Follow-Up',
    message: 'Want to talk through the hematocrit first.',
  })
})

test('the recorded consultation resolves the Calendly id to a name', () => {
  // The detail is read back by people, and a bare UUID tells them nothing about
  // which appointment the patient was offered.
  const plan = planCompletion(
    draft({ disposition: 'continue_protocol', consultation: consult({ eventTypeId: 'gone' }) }),
    'Dr Smith'
  )
  assert.equal(plan.detail.consultation?.eventTypeName, 'Unknown type')
})

test('a consultation names the review in the queue when nothing louder happened', () => {
  assert.equal(
    planCompletion(
      draft({ disposition: 'follow_up_needed', consultation: consult() }),
      'Dr Smith'
    ).resolution,
    'Follow-up needed: consultation — AlphaMD Provider, Secondary Follow-Up'
  )
})

test('labs outrank a consultation in the resolution', () => {
  // Both reach the patient, but the draw is the one they pay for and travel to.
  assert.equal(
    planCompletion(
      draft({
        disposition: 'follow_up_needed',
        labOrders: [labs({ timing: 'custom', customDate: '2099-01-04' })],
        consultation: consult(),
      }),
      'Dr Smith'
    ).resolution,
    'Follow-up needed: labs — Jan 4, 2099'
  )
})

test('an ordered lab reaches the chart, the hand-off and the record', () => {
  const order = labs({ testCodes: ['cbc_85025', 'cmp_80053'], requiredCodes: ['cbc_85025'] })
  const plan = planCompletion(
    draft({ disposition: 'continue_protocol', labOrders: [order] }),
    'Dr Smith'
  )

  assert.match(plan.note, /Labs ordered: Now — CBC \(85025\), CMP \(80053\)/)
  assert.match(plan.note, /For customer service: Labs ordered — Now — CBC \(85025\)/)
  assert.match(plan.note, /nothing to do here unless they ask about it/)
  // Kept whole, so a later reader can see what the review decided to send even
  // if the requisition that went out disagrees.
  assert.deepEqual(plan.detail.labOrders, [order])
})

test('two orders in one review each get their own line, and one explanation', () => {
  // Labs now to confirm the change, and a redraw on the interval. One decision.
  const plan = planCompletion(
    draft({
      disposition: 'follow_up_needed',
      labOrders: [labs(), labs({ timing: 'custom', customDate: '2099-01-04' })],
    }),
    'Dr Smith'
  )

  assert.match(plan.note, /Labs ordered: Now — CBC \(85025\)/)
  assert.match(plan.note, /Labs ordered: Jan 4, 2099 — CBC \(85025\)/)
  assert.equal(plan.note.match(/nothing to do here unless they ask/g)?.length, 1)
})

test('the resolution leads with when labs are coming, not which tests', () => {
  // A queue row has no room for fifteen test names, and the date is what a
  // reader scanning the queue is after.
  assert.equal(
    planCompletion(
      draft({
        disposition: 'follow_up_needed',
        labOrders: [labs({ timing: 'custom', customDate: '2099-01-04' })],
      }),
      'Dr Smith'
    ).resolution,
    'Follow-up needed: labs — Jan 4, 2099'
  )
})

test('a dose change still outranks an order in the resolution', () => {
  // Both can be true in one review. The new dose is the thing somebody has to
  // act on today.
  assert.equal(
    planCompletion(
      draft({ disposition: 'dose_change', doseChanges: [testosterone], labOrders: [labs()] }),
      'Dr Smith'
    ).resolution,
    'Dose change: Testosterone cypionate — 160mg/week'
  )
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

test('a staged consultation tells the patient how to book, after the provider’s words', () => {
  const audiences = reviewAudiences({ ...full, consultation: consult() }, 'Dr Smith')

  assert.ok(audiences.patient.startsWith('Hi Marcus,\n\nYour provider raised your dose.'))
  assert.match(audiences.patient, /To book your AlphaMD Provider, Secondary Follow-Up/)
})

test('the booking link itself is not in the previewed or recorded text', () => {
  // A single-use URL would be dead by the time anyone read the note, and one on
  // screen before approval is one that can be sent without approving.
  const audiences = reviewAudiences({ ...full, consultation: consult() }, 'Dr Smith')

  assert.ok(!audiences.patient.includes(BOOKING_URL))
  assert.ok(!audiences.chart.includes(BOOKING_URL))
  assert.match(audiences.patient, /\[single-use booking link\]/)
})

test('a consultation with no message written still tells the patient how to book', () => {
  // Being asked to come in and told nothing about how would be the one combination
  // the patient cannot act on.
  const audiences = reviewAudiences(
    draft({ disposition: 'follow_up_needed', consultation: consult() }),
    'Dr Smith'
  )

  assert.match(audiences.patient, /To book your AlphaMD Provider, Secondary Follow-Up/)
  assert.match(audiences.chart, /Message for the patient: To book your/)
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
      draft({ disposition, doseChanges: [testosterone], labOrders: [labs()] }),
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

/**
 * The recommended protocol, as far as the text is concerned.
 *
 * `protocols/protocolPlan.ts` decides what these values are; here the only
 * question is whether the three readers are told the right thing about them.
 */

const QUOTE: ProtocolOutcome = {
  kind: 'quote',
  lines: ['Testosterone Cypionate', 'Base Price: $129.00/mo', 'Subscription Total: $137.39'],
  total: '$137.39',
  caveat: 'Quoted at list price with no discounts applied.',
}

const HANDED_OFF: ProtocolOutcome = {
  kind: 'handed-off',
  reasons: ['Sermorelin (300mcg) — more than one product matches; pick one.'],
}

test('a quote is stated once on the chart, without the breakdown', () => {
  // `sendProtocol` writes a second note carrying the full pricing. Two versions of
  // one price on a chart is how they come to disagree.
  const note = planCompletion(full, 'Dr Smith', QUOTE).note

  assert.match(note, /Recommended protocol sent — \$137\.39 due today\./)
  assert.match(note, /Quoted at list price/)
  assert.equal(note.includes('Base Price: $129.00/mo'), false)
})

test('customer service is told a quote needs nothing from them, and why to expect a call', () => {
  const audiences = reviewAudiences(full, 'Dr Smith', QUOTE)

  assert.match(audiences.customerService, /the patient is emailed a quote for \$137\.39 due today/)
  assert.match(audiences.customerService, /nothing to do here unless they ask/)
  assert.match(audiences.customerService, /Quoted at list price/)
})

test('a handoff is a task, and reads as one', () => {
  const audiences = reviewAudiences(full, 'Dr Smith', HANDED_OFF)

  assert.match(audiences.customerService, /price this one by hand and send it/)
  assert.match(audiences.customerService, /more than one product matches/)

  assert.match(audiences.chart, /A recommended protocol was not sent/)
  assert.match(audiences.chart, /more than one product matches/)
})

test('a handoff never claims a price went out', () => {
  const audiences = reviewAudiences(full, 'Dr Smith', HANDED_OFF)

  assert.equal(audiences.chart.includes('protocol sent'), false)
  assert.equal(audiences.patient.includes('protocol'), false)
})

test('the patient hears nothing about the protocol here — the quote is its own email', () => {
  // Deliberate, and the same as the admin app: the provider's message is about the
  // labs, and the quote arrives with its own subject line and its own call to
  // action.
  const untouched = reviewAudiences(full, 'Dr Smith').patient

  for (const outcome of [QUOTE, HANDED_OFF]) {
    assert.equal(reviewAudiences(full, 'Dr Smith', outcome).patient, untouched)
  }
})

test('a review that sends no protocol reads exactly as it did before quoting existed', () => {
  assert.equal(
    reviewAudiences(full, 'Dr Smith', null).chart,
    reviewAudiences(full, 'Dr Smith').chart
  )
})

test('the customer service text the summary shows is still the text the note carries', () => {
  // The invariant from above, re-checked with a quote in play: the protocol lines
  // go through the same composition rather than being appended for display.
  for (const outcome of [QUOTE, HANDED_OFF, null]) {
    const audiences = reviewAudiences(full, 'Dr Smith', outcome)
    const note = planCompletion(full, 'Dr Smith', outcome).note

    assert.ok(note.includes(`For customer service: ${audiences.customerService}`))
    assert.equal(audiences.chart, note)
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
