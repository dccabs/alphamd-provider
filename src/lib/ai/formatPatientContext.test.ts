import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  EMPTY_CONTEXT,
  formatPatientContext,
  type PatientContext,
} from './patientContextFormat.ts'

function context(overrides: Partial<PatientContext> = {}): PatientContext {
  return { ...EMPTY_CONTEXT, ...overrides }
}

describe('formatPatientContext', () => {
  it('omits sections with no data rather than asserting an absence', () => {
    const rendered = formatPatientContext(context())
    assert.equal(rendered, '# Patient context')
    assert.doesNotMatch(rendered, /subscription/i)
  })

  it('puts the message history in chronological order', () => {
    const rendered = formatPatientContext(
      context({
        messages: [
          { message: 'newest', created_at: '2026-03-02T00:00:00Z', is_staff: false },
          { message: 'oldest', created_at: '2026-03-01T00:00:00Z', is_staff: true },
        ],
      })
    )
    assert.ok(rendered.indexOf('oldest') < rendered.indexOf('newest'))
  })

  it('marks who wrote each message and flags internal notes', () => {
    const rendered = formatPatientContext(
      context({
        messages: [
          { message: 'internal only', created_at: '2026-03-01T00:00:00Z', is_staff: true, is_public: false },
        ],
      })
    )
    assert.match(rendered, /\[ALPHAMD STAFF\] \(internal\)/)
  })

  it('includes the lab summary, which the ported original had no reason to', () => {
    assert.match(formatPatientContext(context({ labSummary: 'Hct 54%' })), /Hct 54%/)
  })

  it('truncates long content instead of blowing the prompt budget', () => {
    const rendered = formatPatientContext(
      context({ messages: [{ message: 'x'.repeat(900), created_at: '2026-03-01T00:00:00Z' }] })
    )
    assert.match(rendered, /x{500}\.\.\./)
    assert.doesNotMatch(rendered, /x{600}/)
  })

  it('survives a requisition whose requests payload is unparseable', () => {
    const rendered = formatPatientContext(
      context({ labRequisitions: [{ requests: '{not json', created_at: '2026-03-01T00:00:00Z' }] })
    )
    assert.match(rendered, /requisition created/)
  })

  it('reads requisition test names from an array or a JSON string', () => {
    const rendered = formatPatientContext(
      context({
        labRequisitions: [
          { requests: '[{"name":"CBC"},{"name":"CMP"}]', created_at: '2026-03-01T00:00:00Z' },
          { requests: ['Testosterone'], created_at: '2026-02-01T00:00:00Z' },
        ],
      })
    )
    assert.match(rendered, /CBC, CMP/)
    assert.match(rendered, /Testosterone/)
  })

  it('does not throw on an unparseable date', () => {
    assert.match(
      formatPatientContext(context({ notes: [{ note: 'n', created_at: 'not a date' }] })),
      /Unknown date/
    )
  })
})
