import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { EMPTY_ORDER } from '../labOrders/order.ts'
import { describeDecision, describeEscalation } from './decision.ts'
import {
  EMPTY_DRAFT,
  type DoseChange,
  type DraftMedication,
  type ReviewDraft,
} from '../labReviews/reviewDraft.ts'
import { EMPTY_ESCALATION } from '../labReviews/needsAttention.ts'

function draft(overrides: Partial<ReviewDraft> = {}): ReviewDraft {
  return { ...EMPTY_DRAFT, ...overrides }
}

function med(overrides: Partial<DraftMedication> = {}): DraftMedication {
  return { medicationId: null, name: '', dose: '', sig: '', dosageMg: null, ...overrides }
}

function change(overrides: Partial<DoseChange> = {}): DoseChange {
  return { medicationId: null, medication: '', from: '', value: '', sig: '', ...overrides }
}

describe('describeDecision', () => {
  it('comes back empty when nothing has been recorded', () => {
    // The caller decides what an absent decision means, and the modal shows this
    // text to the provider — a fallback sentence would appear on screen as though
    // it were something they wrote.
    assert.equal(describeDecision(draft()), '')
  })

  it('passes the disposition through by its human label', () => {
    assert.match(describeDecision(draft({ disposition: 'continue_protocol' })), /Continue protocol/)
  })

  it('states a dose change with its target', () => {
    const described = describeDecision(
      draft({
        disposition: 'dose_change',
        doseChanges: [change({ medication: 'Testosterone cypionate', value: '160mg/wk' })],
      })
    )
    assert.match(described, /Testosterone cypionate to 160mg\/wk/)
  })

  it('gives the model both ends of a dose change, so it cannot invent the old one', () => {
    const described = describeDecision(
      draft({
        disposition: 'dose_change',
        doseChanges: [
          change({
            medicationId: 4821,
            medication: 'Testosterone cypionate',
            from: '140mg/week',
            value: '160mg/week',
            sig: 'Inject .4mL subcutaneously every 3.5 days.',
          }),
        ],
      })
    )

    assert.match(
      described,
      /Dose change: Testosterone cypionate from 140mg\/week to 160mg\/week \(Inject \.4mL subcutaneously every 3\.5 days\)\./
    )
  })

  it('gives each changed medication its own sentence', () => {
    // One sentence for two changes would get one plan written for two doses.
    const described = describeDecision(
      draft({
        disposition: 'dose_change',
        doseChanges: [
          change({ medication: 'Testosterone cypionate', from: '160mg/week', value: '140mg/week' }),
          change({ medication: 'Anastrozole', from: '0.5mg twice weekly', value: '0.25mg twice weekly' }),
          change({ value: 'ignored, nothing is named' }),
        ],
      })
    )

    assert.match(described, /Dose change: Testosterone cypionate from 160mg\/week to 140mg\/week\./)
    assert.match(described, /Dose change: Anastrozole from 0\.5mg twice weekly to 0\.25mg twice weekly\./)
    assert.doesNotMatch(described, /ignored/)
  })

  it('does not claim a dose when only the medication is named', () => {
    const described = describeDecision(draft({ doseChanges: [change({ medication: 'Anastrozole' })] }))
    assert.match(described, /Dose change: Anastrozole\./)
    assert.doesNotMatch(described, / to \./)
  })

  it('lists added medications', () => {
    const described = describeDecision(
      draft({
        disposition: 'follow_up_needed',
        newMedications: [
          med({ medicationId: 29, name: 'Enclomiphene', dose: '12.5mg' }),
          med({ dose: 'ignored' }),
        ],
      })
    )
    assert.match(described, /Medication being added: Enclomiphene at 12\.5mg\./)
    assert.doesNotMatch(described, /ignored/)
  })

  it('hands over the labs being ordered, and when they go out', () => {
    // The one decision the patient acts on themselves. Without it a message
    // written for them cannot mention the draw that is coming.
    const described = describeDecision(
      draft({
        disposition: 'follow_up_needed',
        labOrders: [
          {
            ...EMPTY_ORDER,
            timing: 'custom',
            customDate: '2099-01-04',
            providerId: 'provider-uuid',
            testCodes: ['cbc_85025', 'testosterone_total_84403'],
            diagnosisCodes: ['E29.1'],
          },
        ],
      })
    )

    assert.match(
      described,
      /Labs being ordered — Jan 4, 2099 — CBC \(85025\), Testosterone, Total \(84403\)\./
    )
  })

  it('hands over the consultation the patient is being asked to book', () => {
    const described = describeDecision(
      draft({
        disposition: 'follow_up_needed',
        consultation: {
          eventTypeId: '2d7a15dd-4c53-479b-b8ff-d26c508f4995',
          message: 'Want to talk through the hematocrit first.',
          bookingUrl: 'https://calendly.com/d/abc-def-ghi',
          expiresAt: null,
        },
      })
    )

    assert.match(
      described,
      /link to book a consultation — AlphaMD Provider, Secondary Follow-Up · 15 minutes\./
    )
    // Handed over separately: it is the provider's own words to the patient, and a
    // message drafted for them should not contradict what the invitation says.
    assert.match(described, /Want to talk through the hematocrit first\./)
  })

  it('tells the assistant not to write booking instructions, since they are appended', () => {
    const described = describeDecision(
      draft({
        disposition: 'follow_up_needed',
        consultation: {
          eventTypeId: '2d7a15dd-4c53-479b-b8ff-d26c508f4995',
          message: '',
          bookingUrl: 'https://calendly.com/d/abc-def-ghi',
          expiresAt: null,
        },
      })
    )

    assert.match(described, /Do not write booking instructions or a link\./)
    // And never the link itself. It is minted before approval and shown to nobody;
    // a model given it could put it in a draft the provider then sends early.
    assert.ok(!described.includes('calendly.com'))
  })

  it('says nothing about a consultation when none was staged', () => {
    assert.doesNotMatch(describeDecision(draft({ disposition: 'continue_protocol' })), /consultation/)
  })

  it('hands over the sig of an added medication rather than letting it be derived', () => {
    const described = describeDecision(
      draft({
        disposition: 'dose_change',
        doseChanges: [change({ medication: 'Testosterone cypionate', value: '160mg/week' })],
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

  it('carries the written fields over as recorded entries', () => {
    const described = describeDecision(
      draft({
        patientMessage: 'Start the new dose with the next shipment.',
        csInstructions: 'Book the 8 week draw.',
        providerNote: 'Lowered testosterone for the rising hematocrit.',
      })
    )

    assert.match(described, /message being sent to the patient: Start the new dose/)
    assert.match(described, /Handed to customer service: Book the 8 week draw\./)
    assert.match(described, /note for the chart: Lowered testosterone/)
  })

  it('leaves out the field being drafted, so it is not context for itself', () => {
    const full = {
      patientMessage: 'Start the new dose with the next shipment.',
      csInstructions: 'Book the 8 week draw.',
      providerNote: 'Lowered testosterone for the rising hematocrit.',
    }

    const message = describeDecision(draft(full), { omit: 'patientMessage' })
    assert.doesNotMatch(message, /next shipment/)
    assert.match(message, /Lowered testosterone/)

    const note = describeDecision(draft(full), { omit: 'providerNote' })
    assert.doesNotMatch(note, /Lowered testosterone/)
    assert.match(note, /next shipment/)

    assert.doesNotMatch(describeDecision(draft(full), { omit: 'csInstructions' }), /8 week draw/)
  })

  it('keeps the structured decision whichever field is being drafted', () => {
    // Omitting a field's prose must not cost the dose change it belongs to.
    const described = describeDecision(
      draft({
        disposition: 'dose_change',
        doseChanges: [change({ medication: 'Testosterone cypionate', value: '140mg/week' })],
        providerNote: 'Hct 52.4.',
      }),
      { omit: 'providerNote' }
    )

    assert.match(described, /Disposition chosen: Dose change\./)
    assert.match(described, /Dose change: Testosterone cypionate to 140mg\/week\./)
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
