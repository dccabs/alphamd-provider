import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { describeDecision, describeEscalation } from './decision.ts'
import {
  EMPTY_DRAFT,
  type DraftMedication,
  type ReviewDraft,
} from '../labReviews/reviewDraft.ts'
import { EMPTY_ESCALATION } from '../labReviews/needsAttention.ts'

function draft(overrides: Partial<ReviewDraft> = {}): ReviewDraft {
  return { ...EMPTY_DRAFT, ...overrides }
}

function med(overrides: Partial<DraftMedication> = {}): DraftMedication {
  return { medicationId: null, name: '', dose: '', sig: '', ...overrides }
}

describe('describeDecision', () => {
  it('refuses to let the model invent a plan when nothing is decided', () => {
    const described = describeDecision(draft())
    assert.match(described, /not recorded a decision/)
    assert.match(described, /do not state a plan/)
  })

  it('passes the disposition through by its human label', () => {
    assert.match(describeDecision(draft({ disposition: 'continue_protocol' })), /Continue protocol/)
  })

  it('states a dose change with its target', () => {
    const described = describeDecision(
      draft({ disposition: 'dose_change', doseMedication: 'Testosterone cypionate', doseValue: '160mg/wk' })
    )
    assert.match(described, /Testosterone cypionate to 160mg\/wk/)
  })

  it('gives the model both ends of a dose change, so it cannot invent the old one', () => {
    const described = describeDecision(
      draft({
        disposition: 'dose_change',
        doseMedication: 'Testosterone cypionate',
        doseFrom: '140mg/week',
        doseValue: '160mg/week',
        doseSig: 'Inject .4mL subcutaneously every 3.5 days.',
      })
    )

    assert.match(
      described,
      /Dose change: Testosterone cypionate from 140mg\/week to 160mg\/week \(Inject \.4mL subcutaneously every 3\.5 days\)\./
    )
  })

  it('does not claim a dose when only the medication is named', () => {
    const described = describeDecision(draft({ doseMedication: 'Anastrozole' }))
    assert.match(described, /Dose change: Anastrozole\./)
    assert.doesNotMatch(described, / to \./)
  })

  it('lists follow-up kinds and added medications', () => {
    const described = describeDecision(
      draft({
        disposition: 'follow_up_needed',
        followUpKinds: ['more_labs', 'new_medication'],
        newMedications: [
          med({ medicationId: 29, name: 'Enclomiphene', dose: '12.5mg' }),
          med({ dose: 'ignored' }),
        ],
      })
    )
    assert.match(described, /Needs more labs, Add a new medication/)
    assert.match(described, /Medication being added: Enclomiphene at 12\.5mg\./)
    assert.doesNotMatch(described, /ignored/)
  })

  it('hands over the sig of an added medication rather than letting it be derived', () => {
    const described = describeDecision(
      draft({
        disposition: 'dose_change',
        doseMedication: 'Testosterone cypionate',
        doseValue: '160mg/week',
        newMedications: [
          med({
            medicationId: 13,
            name: 'Anastrozole',
            dose: '1.00mg - Take 1/2 tablet (0.50mg) by mouth twice weekly.',
          }),
          med({ medicationId: 16, name: 'HCG', dose: '500 Units Weekly', sig: 'Inject 0.25mL twice weekly.' }),
        ],
      })
    )

    // Both decisions, each as its own sentence: the model is writing up two
    // things, not one.
    assert.match(described, /Dose change: Testosterone cypionate to 160mg\/week\./)
    assert.match(
      described,
      /Medication being added: Anastrozole at 1\.00mg - Take 1\/2 tablet \(0\.50mg\) by mouth twice weekly\./
    )
    assert.match(described, /Medication being added: HCG at 500 Units Weekly \(Inject 0\.25mL twice weekly\)\./)
  })

  it('always forbids extending the recorded decision', () => {
    assert.match(describeDecision(draft({ disposition: 'dose_change' })), /do not contradict/)
  })
})

describe('describeEscalation', () => {
  it('names the recipients', () => {
    const described = describeEscalation({
      ...EMPTY_ESCALATION,
      targets: ['customer_service', 'provider'],
    })
    assert.match(described, /Customer service and Another provider/)
  })

  it('warns off clinical instructions when customer service is a recipient', () => {
    const described = describeEscalation({ ...EMPTY_ESCALATION, targets: ['customer_service'] })
    assert.match(described, /not a clinician/)
  })

  it('says nothing extra for a provider-only handoff', () => {
    const described = describeEscalation({ ...EMPTY_ESCALATION, targets: ['provider'] })
    assert.doesNotMatch(described, /not a clinician/)
  })
})
