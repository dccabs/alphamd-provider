import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { systemPromptFor, userPromptFor } from './prompts.ts'

describe('systemPromptFor', () => {
  it('tells the chart note not to address the patient', () => {
    const prompt = systemPromptFor('chart_note')
    assert.match(prompt, /third person/i)
    assert.match(prompt, /Do not address the patient/i)
  })

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
    assert.equal(systemPromptFor('chart_note', 'support'), systemPromptFor('chart_note', 'self'))
  })
})

describe('userPromptFor', () => {
  const base = { task: 'chart_note' as const, existing: '', instructions: '', context: '' }

  it('asks for a fresh draft when the field is empty', () => {
    const prompt = userPromptFor(base)
    assert.match(prompt, /Write the chart note/)
    assert.doesNotMatch(prompt, /current draft/)
  })

  it('switches to revision when the provider has already written something', () => {
    const prompt = userPromptFor({ ...base, existing: 'Hct 54, holding dose.' })
    assert.match(prompt, /current draft/)
    assert.match(prompt, /Hct 54, holding dose\./)
    assert.match(prompt, /do not drop or contradict/)
    assert.doesNotMatch(prompt, /Write the chart note/)
  })

  it('treats whitespace as empty rather than as a draft to preserve', () => {
    assert.match(userPromptFor({ ...base, existing: '   \n  ' }), /Write the chart note/)
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
