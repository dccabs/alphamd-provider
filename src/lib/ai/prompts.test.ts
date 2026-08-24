import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  systemPromptFor,
  systemPromptForChartSummary,
  systemPromptForField,
  userPromptFor,
  userPromptForChartSummary,
  userPromptForField,
} from './prompts.ts'
import { REVIEW_FIELDS } from './reviewFields.ts'

describe('systemPromptFor', () => {
  it('leads the handoff note with the required action', () => {
    assert.match(systemPromptFor('handoff_note'), /stated first/i)
  })

  it('signs a support reply as AlphaMD Support and defers clinically', () => {
    const prompt = systemPromptFor('cs_reply', 'support')
    assert.match(prompt, /AlphaMD Support/)
    assert.match(prompt, /third person/i)
  })

  it('writes a self reply in the first person with no sign-off', () => {
    const prompt = systemPromptFor('cs_reply', 'self')
    assert.match(prompt, /first person/i)
    assert.match(prompt, /Do not add a sign-off/i)
  })

  it('only varies by identity for the reply task', () => {
    assert.equal(
      systemPromptFor('handoff_note', 'support'),
      systemPromptFor('handoff_note', 'self')
    )
  })
})

describe('userPromptFor', () => {
  const base = { task: 'handoff_note' as const, existing: '', instructions: '', context: '' }

  it('asks for a fresh draft when the field is empty', () => {
    const prompt = userPromptFor(base)
    assert.match(prompt, /Write the handoff note/)
    assert.doesNotMatch(prompt, /current draft/)
  })

  it('switches to revision when the provider has already written something', () => {
    const prompt = userPromptFor({ ...base, existing: 'Hct 54, holding dose.' })
    assert.match(prompt, /current draft/)
    assert.match(prompt, /Hct 54, holding dose\./)
    assert.match(prompt, /do not drop or contradict/)
    assert.doesNotMatch(prompt, /Write the handoff note/)
  })

  it('treats whitespace as empty rather than as a draft to preserve', () => {
    assert.match(userPromptFor({ ...base, existing: '   \n  ' }), /Write the handoff note/)
  })

  it('includes the context and the steer when present', () => {
    const prompt = userPromptFor({
      ...base,
      context: '# Patient context\n- Name: Test Patient',
      instructions: 'mention the low ferritin',
    })
    assert.match(prompt, /Test Patient/)
    assert.match(prompt, /low ferritin/)
  })

  it('omits empty sections instead of emitting bare headings', () => {
    assert.doesNotMatch(userPromptFor(base), /What the provider asked for/)
  })
})

describe('systemPromptForField', () => {
  it('holds every field to the same fidelity contract', () => {
    // The contract is the feature. A field that shipped without it would draft
    // plausible clinical text nobody chose.
    for (const field of REVIEW_FIELDS) {
      const prompt = systemPromptForField(field)
      assert.match(prompt, /SOURCE OF TRUTH/, field)
      assert.match(prompt, /no recommendations/i, field)
      assert.match(prompt, /Never state an opinion of your own/i, field)
      assert.match(prompt, /borderline/i, field)
      assert.match(prompt, /No Markdown/i, field)
    }
  })

  it('never lets a field believe it has seen the patient', () => {
    for (const field of REVIEW_FIELDS) {
      assert.match(systemPromptForField(field), /no other information about this patient/i, field)
    }
  })

  it('addresses the patient only in the message written to them', () => {
    // Second person for the patient here; the provider is still referred to in
    // the third, which is why this cannot just assert the absence of one phrase.
    assert.match(systemPromptForField('patientMessage'), /Address the patient directly/i)
    assert.match(systemPromptForField('providerNote'), /Do not address the patient/i)
    assert.match(systemPromptForField('csInstructions'), /not to the patient/i)
  })

  it('asks the chart note for what a results review is documented on', () => {
    // The parts a lab-review note is faulted for missing: the values behind the
    // decision, an interval on the plan, abnormals seen and left alone, and that
    // the patient was actually told.
    const prompt = systemPromptForField('providerNote')
    assert.match(prompt, /What was reviewed/i)
    assert.match(prompt, /objective findings/i)
    assert.match(prompt, /assessment/i)
    assert.match(prompt, /interval/i)
    assert.match(prompt, /not acting on it/i)
    assert.match(prompt, /What the patient was told/i)
  })

  it('keeps the chart note in the third person and out of speculation', () => {
    const prompt = systemPromptForField('providerNote')
    assert.match(prompt, /third person/i)
    assert.match(prompt, /Do not address the patient/i)
    assert.match(prompt, /medical record/i)
    assert.match(prompt, /Speculate/i)
    assert.match(prompt, /Carry forward/i)
  })

  it('has the patient message relay the decision without adding to it', () => {
    const prompt = systemPromptForField('patientMessage')
    assert.match(prompt, /What is changing/i)
    assert.match(prompt, /next draw/i)
    assert.match(prompt, /looks great/i)
    assert.match(prompt, /internal handoff/i)
  })

  it('opens the patient message with a greeting and closes it with thanks', () => {
    // Every one of these goes out over the practice's name, so the frame around
    // it is fixed: greeted by name, told how to reply, thanked.
    const prompt = systemPromptForField('patientMessage')
    assert.match(prompt, /"Hi <first name>,"/)
    assert.match(prompt, /"Hello," if you were not given one/)
    assert.match(prompt, /reply to this message/i)
    assert.match(prompt, /Profile → Messages/)
    assert.match(prompt, /thank-you to close/i)
    // The thanks is the last line; a name or "Sincerely" under it would be
    // signing on behalf of whoever actually sends this.
    assert.match(prompt, /no name, no title/i)
  })

  it('writes the patient message as the team, for the provider, and by name', () => {
    // The reader has to know who decided. A message that says "I lowered your
    // dose" is signed by whoever sends it, which is not the provider.
    const prompt = systemPromptForField('patientMessage')
    assert.match(prompt, /care team/i)
    assert.match(prompt, /on the provider's behalf/i)
    assert.match(prompt, /third person/i)
    assert.match(prompt, /first name/i)
    assert.match(prompt, /finished reviewing/i)
    assert.match(prompt, /What happens next/i)
  })

  it('does not let the patient message give the provider a gender', () => {
    // It reached for "she" when the brief used it as an example. Nothing in this
    // request says who the provider is, so a pronoun is an invented fact about a
    // named clinician, in a message that goes to the patient.
    assert.match(systemPromptForField('patientMessage'), /never use a pronoun for them/i)
  })

  it('never lets the patient message answer for the provider', () => {
    assert.match(systemPromptForField('patientMessage'), /clinical question/i)
  })

  it('warns the customer service field off prescribing', () => {
    const prompt = systemPromptForField('csInstructions')
    assert.match(prompt, /not a clinician/i)
    assert.match(prompt, /prescribing/i)
  })
})

describe('userPromptForField', () => {
  const base = {
    field: 'providerNote' as const,
    existing: '',
    instructions: '',
    recorded: '',
  }

  it('names the field it wants written', () => {
    const prompt = userPromptForField({ ...base, instructions: 'hct up, recheck in 8wks' })
    assert.match(prompt, /Write the Note for the chart field/)
    assert.match(prompt, /hct up, recheck in 8wks/)
  })

  it('protects text already in the field', () => {
    const prompt = userPromptForField({ ...base, existing: 'Hct 54.' })
    assert.match(prompt, /already in this field/)
    assert.match(prompt, /Hct 54\./)
    assert.match(prompt, /do not drop, soften, strengthen or contradict/)
  })

  it('hands the recorded decisions to the chart note as background', () => {
    const prompt = userPromptForField({
      ...base,
      instructions: 'note the rising hct',
      recorded: 'Disposition chosen: Dose change.',
    })
    assert.match(prompt, /already recorded in this review/)
    assert.match(prompt, /Disposition chosen: Dose change\./)
    assert.match(prompt, /do not restate them in this field/)
  })

  it('hands the same decisions to the patient message as its substance', () => {
    // The one field whose job is to repeat them. Told to hold back here, it
    // drafts a message that mentions none of what changed.
    const prompt = userPromptForField({
      field: 'patientMessage',
      existing: '',
      instructions: '',
      recorded: 'Dose change: Testosterone cypionate from 160mg/week to 140mg/week.',
    })
    assert.match(prompt, /substance of this field/)
    assert.match(prompt, /write them out even if the provider did not repeat them/)
    assert.doesNotMatch(prompt, /do not restate them/)
  })

  it('gives a patient-facing field the name to write to', () => {
    const prompt = userPromptForField({
      field: 'patientMessage',
      existing: '',
      instructions: '',
      recorded: 'Disposition chosen: Dose change.',
      firstName: 'Marcus',
    })
    assert.match(prompt, /Who you are writing to\nMarcus\./)
    assert.match(prompt, /use no other name/)
  })

  it('leaves the name out when the field is not written to the patient', () => {
    // The chart note says "the patient". Handing it a first name at all is how
    // one ends up in a medical record that reads like correspondence.
    assert.doesNotMatch(
      userPromptForField({ ...base, instructions: 'hct up' }),
      /Who you are writing to/
    )
  })

  it('a name on its own is still nothing to write', () => {
    assert.match(
      userPromptForField({ ...base, field: 'patientMessage', firstName: 'Marcus' }),
      /Reply with an empty response/
    )
  })

  it('drafts a relay field from the decisions alone, with no steer', () => {
    // Pressing the button on an empty patient message has to produce something.
    const prompt = userPromptForField({
      field: 'patientMessage',
      existing: '',
      instructions: '',
      recorded: 'Disposition chosen: Dose change.',
    })
    assert.match(prompt, /Write the Message for patient field/)
    assert.doesNotMatch(prompt, /Reply with an empty response/)
  })

  it('omits empty sections instead of emitting bare headings', () => {
    const prompt = userPromptForField({ ...base, instructions: 'hct up' })
    assert.doesNotMatch(prompt, /already in this field/)
    assert.doesNotMatch(prompt, /already recorded in this review/)
  })

  it('treats whitespace as nothing at all', () => {
    const prompt = userPromptForField({ ...base, existing: '  \n ', instructions: '   ' })
    assert.match(prompt, /nothing to write/i)
  })

  it('refuses to write a field with no input of any kind', () => {
    // Only reachable past the button's own guard, and the honest answer is an
    // empty response rather than a field invented from nothing.
    assert.match(userPromptForField(base), /Reply with an empty response/)
  })

  it('asks for each field by its own name', () => {
    assert.match(
      userPromptForField({ ...base, field: 'csInstructions', instructions: 'book the draw' }),
      /Write the Instructions for customer service field/
    )
  })
})

describe('chart summary prompts', () => {
  it('asks for a short factual wrap-up, not a second note for the chart', () => {
    const prompt = systemPromptForChartSummary()
    assert.match(prompt, /SHORT COMPLETION SUMMARY/)
    assert.match(prompt, /Do not repeat it/)
    assert.match(prompt, /two to four sentences/)
    assert.match(prompt, /Do not paste the email/)
    assert.match(prompt, /Only facts from the events/)
  })

  it('hands the events as the only source', () => {
    const prompt = userPromptForChartSummary(
      'Disposition: Follow-up needed.\nNew medication: Testosterone cypionate — 160mg/week.'
    )
    assert.match(prompt, /What this review did/)
    assert.match(prompt, /Testosterone cypionate — 160mg\/week/)
    assert.match(prompt, /Write the completion summary/)
  })

  it('refuses to invent a summary from nothing', () => {
    assert.match(userPromptForChartSummary('   \n'), /empty response/)
  })
})
