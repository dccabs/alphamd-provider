import assert from 'node:assert/strict'
import test from 'node:test'

import type { ConsultRequest } from '../consultations/request.ts'
import { EMPTY_ORDER, type LabOrder } from '../labOrders/order.ts'
import { EMPTY_DRAFT, type DoseChange, type DraftMedication, type ReviewDraft } from './reviewDraft.ts'
import {
  REVIEW_STEPS,
  STEP_SKIPPED_LABELS,
  STEP_TITLES,
  allSettled,
  hasContent,
  isReviewStep,
  isSettled,
  openStep,
  parseSkippedSteps,
  stepSummary,
  stepsFor,
  withSkip,
  withoutSkip,
} from './reviewSteps.ts'

const draft = (patch: Partial<ReviewDraft> = {}): ReviewDraft => ({ ...EMPTY_DRAFT, ...patch })

const labs = (patch: Partial<LabOrder> = {}): LabOrder => ({
  ...EMPTY_ORDER,
  providerId: 'provider-uuid',
  testCodes: ['cbc_85025'],
  diagnosisCodes: ['E29.1'],
  ...patch,
})

/** A real Calendly event type, so `consultLine` resolves it. */
const FOLLOW_UP = '2d7a15dd-4c53-479b-b8ff-d26c508f4995'

const consult = (patch: Partial<ConsultRequest> = {}): ConsultRequest => ({
  eventTypeId: FOLLOW_UP,
  message: '',
  bookingUrl: 'https://calendly.com/d/abc-def-ghi',
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

const testosterone = change({
  medicationId: 4821,
  medication: 'Testosterone cypionate',
  from: '140mg/week',
  value: '160mg/week',
  sig: 'Inject .4mL subcutaneously every 3.5 days.',
})

test('every step is titled and says how it reads when skipped', () => {
  for (const step of REVIEW_STEPS) {
    assert.ok(STEP_TITLES[step], `${step} has no title`)
    assert.ok(STEP_SKIPPED_LABELS[step], `${step} has no skipped label`)
  }
})

test('the patient message is the last step, since it is written from the rest', () => {
  assert.equal(REVIEW_STEPS[REVIEW_STEPS.length - 1], 'patientMessage')
})

test('isReviewStep rejects anything not in the list', () => {
  assert.ok(isReviewStep('labOrders'))
  assert.ok(!isReviewStep('concerns'))
  assert.ok(!isReviewStep(3))
  assert.ok(!isReviewStep(null))
})

// --- which steps apply ------------------------------------------------------

test('no steps apply until a disposition is chosen', () => {
  assert.deepEqual(stepsFor(draft()), [])
  assert.equal(openStep(draft()), null)
  assert.ok(!allSettled(draft()))
})

test('a dose change is only asked for under the dose change disposition', () => {
  assert.ok(stepsFor(draft({ disposition: 'dose_change' })).includes('doseChanges'))
  assert.ok(!stepsFor(draft({ disposition: 'follow_up_needed' })).includes('doseChanges'))
  assert.ok(!stepsFor(draft({ disposition: 'continue_protocol' })).includes('doseChanges'))
})

test('continuing the protocol as designed does not ask for a new medication', () => {
  assert.ok(!stepsFor(draft({ disposition: 'continue_protocol' })).includes('newMedications'))
  assert.ok(stepsFor(draft({ disposition: 'follow_up_needed' })).includes('newMedications'))
  assert.ok(stepsFor(draft({ disposition: 'dose_change' })).includes('newMedications'))
})

// This is the case that makes the review recoverable: `validateCompletion` refuses
// to finish with a dose change recorded under another disposition, so the panel
// holding it has to stay on screen to be emptied.
test('a step that no longer applies stays visible while it holds something', () => {
  const stranded = draft({ disposition: 'continue_protocol', doseChanges: [testosterone] })

  assert.ok(stepsFor(stranded).includes('doseChanges'))
  assert.ok(isSettled('doseChanges', stranded))
})

test('a step that no longer applies and holds nothing drops out', () => {
  const empty = draft({ disposition: 'continue_protocol', doseChanges: [] })
  assert.ok(!stepsFor(empty).includes('doseChanges'))
})

test('labs and a consultation are offered under every disposition', () => {
  for (const disposition of ['dose_change', 'continue_protocol', 'follow_up_needed'] as const) {
    const steps = stepsFor(draft({ disposition }))
    assert.ok(steps.includes('labOrders'), `${disposition} does not offer labs`)
    assert.ok(steps.includes('consultation'), `${disposition} does not offer a consultation`)
  }
})

// --- content and settling ---------------------------------------------------

test('nothing has content in an empty draft', () => {
  for (const step of REVIEW_STEPS) {
    assert.ok(!hasContent(step, draft()), `${step} reads as filled in an empty draft`)
  }
})

test('whitespace is not content', () => {
  const blank = draft({ providerNote: '   \n  ', patientMessage: '\n', csInstructions: ' ' })

  assert.ok(!hasContent('providerNote', blank))
  assert.ok(!hasContent('patientMessage', blank))
  assert.ok(!hasContent('csInstructions', blank))
})

test('each step reads its own part of the draft', () => {
  assert.ok(hasContent('doseChanges', draft({ doseChanges: [testosterone] })))
  assert.ok(hasContent('newMedications', draft({ newMedications: [med({ name: 'Anastrozole' })] })))
  assert.ok(hasContent('labOrders', draft({ labOrders: [labs()] })))
  assert.ok(hasContent('consultation', draft({ consultation: consult() })))
  assert.ok(hasContent('providerNote', draft({ providerNote: 'Reviewed.' })))
  assert.ok(hasContent('csInstructions', draft({ csInstructions: 'Ship it.' })))
  assert.ok(hasContent('patientMessage', draft({ patientMessage: 'Hi Dan,' })))
})

test('a step is settled by content or by a recorded skip', () => {
  assert.ok(isSettled('labOrders', draft({ disposition: 'dose_change', labOrders: [labs()] })))
  assert.ok(isSettled('labOrders', draft({ disposition: 'dose_change', skippedSteps: ['labOrders'] })))
  assert.ok(!isSettled('labOrders', draft({ disposition: 'dose_change' })))
})

// --- where the provider is --------------------------------------------------

test('the open step is the first applicable one not settled', () => {
  const started = draft({ disposition: 'dose_change' })
  assert.equal(openStep(started), 'doseChanges')

  const dosed = draft({ disposition: 'dose_change', doseChanges: [testosterone] })
  assert.equal(openStep(dosed), 'newMedications')

  const skipped = draft({
    disposition: 'dose_change',
    doseChanges: [testosterone],
    skippedSteps: ['newMedications', 'labOrders'],
  })
  assert.equal(openStep(skipped), 'consultation')
})

test('a review is only fully settled once every applicable step is dealt with', () => {
  const nearly = draft({
    disposition: 'continue_protocol',
    skippedSteps: ['labOrders', 'consultation', 'providerNote', 'csInstructions'],
  })
  assert.ok(!allSettled(nearly))
  assert.equal(openStep(nearly), 'patientMessage')

  const done = draft({ ...nearly, patientMessage: 'Your labs look good.' })
  assert.ok(allSettled(done))
  assert.equal(openStep(done), null)
})

// Continuing the protocol drops two steps, so it settles with fewer skips than a
// dose change does. Worth pinning: the gate is per-review, not a fixed count.
test('which steps have to be settled follows the disposition', () => {
  const skips = ['labOrders', 'consultation', 'providerNote', 'csInstructions'] as const
  const settled = { skippedSteps: [...skips], patientMessage: 'Done.' }

  assert.ok(allSettled(draft({ disposition: 'continue_protocol', ...settled })))
  assert.ok(!allSettled(draft({ disposition: 'follow_up_needed', ...settled })))
})

// --- skips ------------------------------------------------------------------

test('skipping twice records one skip', () => {
  const once = draft({ skippedSteps: withSkip(draft(), 'labOrders') })
  assert.deepEqual(once.skippedSteps, ['labOrders'])
  assert.deepEqual(withSkip(once, 'labOrders'), ['labOrders'])
})

test('a skip can be withdrawn, so a step filled and re-emptied is asked again', () => {
  const skipped = draft({ disposition: 'dose_change', skippedSteps: ['labOrders', 'consultation'] })
  const reopened = draft({ ...skipped, skippedSteps: withoutSkip(skipped, 'labOrders') })

  assert.deepEqual(reopened.skippedSteps, ['consultation'])
  assert.ok(!isSettled('labOrders', reopened))
})

test('the stored skip list is read tolerantly', () => {
  assert.deepEqual(parseSkippedSteps(undefined), [])
  assert.deepEqual(parseSkippedSteps('labOrders'), [])
  assert.deepEqual(parseSkippedSteps([{ step: 'labOrders' }]), [])
  // A step this build no longer knows about must not settle anything.
  assert.deepEqual(parseSkippedSteps(['labOrders', 'concerns', 42]), ['labOrders'])
  assert.deepEqual(parseSkippedSteps(['labOrders', 'labOrders']), ['labOrders'])
})

// --- collapsed summaries ----------------------------------------------------

test('a step with nothing in it has no summary, so the row says what was decided', () => {
  for (const step of REVIEW_STEPS) {
    assert.equal(stepSummary(step, draft()), '', `${step} summarised an empty draft`)
  }
})

test('a dose change summarises as the medication and the dose it moves to', () => {
  assert.equal(
    stepSummary('doseChanges', draft({ doseChanges: [testosterone] })),
    'Testosterone cypionate → 160mg/week'
  )
})

test('several recorded rows are summarised together', () => {
  const summary = stepSummary(
    'doseChanges',
    draft({
      doseChanges: [
        testosterone,
        change({ medicationId: 4822, medication: 'Anastrozole', value: '0.25mg twice weekly' }),
      ],
    })
  )

  assert.match(summary, /Testosterone cypionate → 160mg\/week/)
  assert.match(summary, /Anastrozole → 0\.25mg twice weekly/)
})

test('a half-recorded row summarises as whatever it does have', () => {
  const summary = stepSummary('doseChanges', draft({ doseChanges: [change({ medication: 'HCG' })] }))
  assert.equal(summary, 'HCG')
})

test('a new medication summarises as its name and dose', () => {
  assert.equal(
    stepSummary(
      'newMedications',
      draft({ newMedications: [med({ name: 'Anastrozole', dose: '0.5mg twice weekly' })] })
    ),
    'Anastrozole — 0.5mg twice weekly'
  )
})

// The point of reusing `orderLine` and `consultLine`: a collapsed row describes the
// order in the same words the chart note and the confirmation screen will.
test('labs and a consultation are summarised with the shared line composers', () => {
  const labSummary = stepSummary('labOrders', draft({ labOrders: [labs()] }))
  assert.match(labSummary, /CBC/)

  const consultSummary = stepSummary('consultation', draft({ consultation: consult() }))
  assert.match(consultSummary, /minutes/)
})

test('a written box summarises as its first line', () => {
  const note = draft({ providerNote: 'Hematocrit is up at 53.2%.\n\nLowering the dose.' })
  assert.equal(stepSummary('providerNote', note), 'Hematocrit is up at 53.2%.')
})

test('a box that opens with blank lines summarises as the first line with words in it', () => {
  const padded = draft({ csInstructions: '\n\n  Ship it Monday.' })
  assert.equal(stepSummary('csInstructions', padded), 'Ship it Monday.')
})

test('a long summary is clamped to one line', () => {
  const long = 'a'.repeat(400)
  const summary = stepSummary('patientMessage', draft({ patientMessage: long }))

  assert.ok(summary.length < 100)
  assert.ok(summary.endsWith('…'))
})
