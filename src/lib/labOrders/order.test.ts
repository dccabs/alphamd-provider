import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { LAB_PRESETS, LAB_TESTS, PHLEBOTOMY_CODE } from './catalog.ts'
import {
  EMPTY_ORDER,
  applyPreset,
  diagnosisPayload,
  orderNote,
  orderSummary,
  requestsPayload,
  scheduledDateFor,
  validateOrder,
  type LabOrder,
} from './order.ts'

function order(overrides: Partial<LabOrder> = {}): LabOrder {
  return {
    ...EMPTY_ORDER,
    providerId: 'provider-uuid',
    testCodes: ['cbc_85025'],
    diagnosisCodes: ['E29.1'],
    ...overrides,
  }
}

describe('scheduledDateFor', () => {
  const from = new Date('2026-03-01T15:00:00Z')

  it('dates a "now" order at the moment it is placed', () => {
    assert.equal(scheduledDateFor('now', '', from)?.getTime(), from.getTime())
  })

  it('offsets by whole weeks', () => {
    const date = scheduledDateFor('in_6_weeks', '', from)!
    assert.equal(date.toISOString(), '2026-04-12T15:00:00.000Z')
  })

  it('clamps a month offset rather than rolling into the next month', () => {
    // 31 August plus six months is 31 February, which does not exist.
    const date = scheduledDateFor('in_6_months', '', new Date(2026, 7, 31, 12))!
    assert.equal(date.getMonth(), 1)
    assert.equal(date.getDate(), 28)
  })

  it('reads a custom date as the day the provider picked, not the day before', () => {
    const date = scheduledDateFor('custom', '2026-09-01')!
    assert.equal(date.getFullYear(), 2026)
    assert.equal(date.getMonth(), 8)
    assert.equal(date.getDate(), 1)
  })

  it('returns null for an unparseable custom date', () => {
    assert.equal(scheduledDateFor('custom', ''), null)
    assert.equal(scheduledDateFor('custom', '09/01/2026'), null)
  })
})

describe('validateOrder', () => {
  it('accepts a complete order', () => {
    assert.deepEqual(validateOrder(order(), 'TX'), [])
  })

  it('requires a provider, a test and a diagnosis code', () => {
    const problems = validateOrder(
      { ...EMPTY_ORDER, testCodes: [], diagnosisCodes: [] },
      'TX'
    )
    assert.equal(problems.length, 3)
  })

  it('refuses to combine therapeutic phlebotomy with anything else', () => {
    const problems = validateOrder(
      order({ testCodes: [PHLEBOTOMY_CODE, 'cbc_85025'] }),
      'TX'
    )
    assert.ok(problems.some((p) => /own requisition/.test(p)))
  })

  it('allows therapeutic phlebotomy on its own', () => {
    assert.deepEqual(
      validateOrder(order({ testCodes: [PHLEBOTOMY_CODE], diagnosisCodes: ['R71.8'] }), 'TX'),
      []
    )
  })

  it('blocks comped tests for New York and New Jersey, spelled either way', () => {
    for (const state of ['NY', 'New Jersey', 'new york']) {
      const problems = validateOrder(order({ compedCodes: ['cbc_85025'] }), state)
      assert.ok(
        problems.some((p) => /Discounted labs/.test(p)),
        `expected a restriction for ${state}`
      )
    }
  })

  it('allows comped tests elsewhere, and with no state on file', () => {
    assert.deepEqual(validateOrder(order({ compedCodes: ['cbc_85025'] }), 'TX'), [])
    assert.deepEqual(validateOrder(order({ compedCodes: ['cbc_85025'] }), null), [])
  })

  it('rejects a custom date the cron would immediately expire', () => {
    const problems = validateOrder(
      order({ timing: 'custom', customDate: '2020-01-01' }),
      'TX'
    )
    assert.ok(problems.some((p) => /in the past/.test(p)))
  })

  it('rejects codes that are not in the catalogue', () => {
    assert.ok(
      validateOrder(order({ testCodes: ['made_up'] }), 'TX').some((p) => /not orderable/.test(p))
    )
    assert.ok(
      validateOrder(order({ diagnosisCodes: ['Z99.9'] }), 'TX').some((p) => /not recognised/.test(p))
    )
  })
})

describe('requestsPayload', () => {
  it('writes the whole catalogue with a flag per test, as the main app does', () => {
    const payload = requestsPayload(order({ testCodes: ['cbc_85025'] }))
    assert.equal(payload.length, LAB_TESTS.length)
    assert.equal(payload.filter((p) => p.is_requested).length, 1)
    assert.equal(payload.find((p) => p.code === 'cbc_85025')?.is_requested, true)
  })

  it('carries the display name, which is what the patient email reads', () => {
    const entry = requestsPayload(order()).find((p) => p.code === 'cbc_85025')
    assert.equal(entry?.name, 'CBC (85025)')
  })

  it('never marks an unselected test required or comped', () => {
    const payload = requestsPayload(
      order({ testCodes: ['cbc_85025'], requiredCodes: ['psa_31348'], compedCodes: ['psa_31348'] })
    )
    const psa = payload.find((p) => p.code === 'psa_31348')
    assert.equal(psa?.is_requested, false)
    assert.equal(psa?.is_required, false)
    assert.equal(psa?.is_comped, false)
  })

  it('marks a selected test required and comped when asked', () => {
    const payload = requestsPayload(
      order({ testCodes: ['cbc_85025'], requiredCodes: ['cbc_85025'], compedCodes: ['cbc_85025'] })
    )
    const cbc = payload.find((p) => p.code === 'cbc_85025')
    assert.equal(cbc?.is_required, true)
    assert.equal(cbc?.is_comped, true)
  })
})

describe('diagnosisPayload', () => {
  it('flags only the chosen codes', () => {
    const payload = diagnosisPayload(order({ diagnosisCodes: ['E29.1'] }))
    assert.equal(payload.filter((d) => d.is_requested).length, 1)
    assert.equal(payload.find((d) => d.code === 'E29.1')?.is_requested, true)
  })
})

describe('applyPreset', () => {
  it('replaces the selection with the preset and carries its required codes', () => {
    const preset = LAB_PRESETS.find((p) => p.id === 'bare_minimum_initial')!
    const applied = applyPreset(order({ testCodes: ['ferritin_82728'] }), preset)
    assert.deepEqual(applied.testCodes, ['testosterone_total_84403'])
    assert.deepEqual(applied.requiredCodes, ['testosterone_total_84403'])
    assert.deepEqual(applied.diagnosisCodes, ['E29.1'])
  })

  it('comps nothing — coverage is a per-patient decision, not part of a panel', () => {
    const preset = LAB_PRESETS.find((p) => p.id === 'annual')!
    assert.deepEqual(applyPreset(order({ compedCodes: ['cbc_85025'] }), preset).compedCodes, [])
  })

  it('leaves timing and provider alone', () => {
    const preset = LAB_PRESETS.find((p) => p.id === 'annual')!
    const applied = applyPreset(order({ timing: 'in_8_weeks' }), preset)
    assert.equal(applied.timing, 'in_8_weeks')
    assert.equal(applied.providerId, 'provider-uuid')
  })

  it('every preset only names catalogue codes', () => {
    const tests = new Set(LAB_TESTS.map((t) => t.code))
    for (const preset of LAB_PRESETS) {
      for (const code of preset.testCodes) {
        assert.ok(tests.has(code), `${preset.id} references unknown test ${code}`)
      }
      for (const code of preset.requiredCodes ?? []) {
        assert.ok(
          preset.testCodes.includes(code),
          `${preset.id} requires ${code} without selecting it`
        )
      }
    }
  })
})

describe('orderNote and orderSummary', () => {
  const date = new Date(2026, 8, 1, 12)

  it('says the patient is about to be emailed for an immediate order', () => {
    const note = orderNote(order(), date, true)
    assert.match(note, /emailed shortly/)
    assert.match(note, /CBC \(85025\)/)
  })

  it('names the date for a future order', () => {
    assert.match(orderNote(order(), date, false), /scheduled for September 1, 2026/)
  })

  it('records what AlphaMD is covering', () => {
    assert.match(
      orderNote(order({ compedCodes: ['cbc_85025'] }), date, false),
      /Covered by AlphaMD/
    )
  })

  it('summarises in one line for the audit trail', () => {
    assert.match(orderSummary(order(), date, true), /^Ordered labs now: CBC/)
    assert.match(orderSummary(order(), date, false), /^Scheduled labs for Sep 1, 2026: CBC/)
  })
})
