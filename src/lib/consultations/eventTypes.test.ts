import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  CONSULTATION_EVENT_TYPES,
  eventTypeById,
  eventTypesFor,
  isActiveMember,
} from './eventTypes.ts'

describe('CONSULTATION_EVENT_TYPES', () => {
  it('has no duplicate ids — a duplicate would mean two entries book the same slot', () => {
    const ids = CONSULTATION_EVENT_TYPES.map((t) => t.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  it('looks up by id and reports an unknown one as undefined', () => {
    assert.equal(eventTypeById('2d7a15dd-4c53-479b-b8ff-d26c508f4995')?.duration, 15)
    assert.equal(eventTypeById('not-a-uuid'), undefined)
  })
})

describe('isActiveMember', () => {
  it('recognises every active-subscription status', () => {
    for (const id of [8, 12, 13, 14, 17]) assert.equal(isActiveMember(id), true)
  })

  it('treats onboarding, cancelled and unknown statuses as non-members', () => {
    for (const id of [3, 4, 10, 23, 25, 26]) assert.equal(isActiveMember(id), false)
    assert.equal(isActiveMember(null), false)
  })
})

describe('eventTypesFor', () => {
  it('suggests follow-ups for an active member', () => {
    const { suggested } = eventTypesFor({ statusId: 8, gender: 'male' })
    assert.ok(suggested.every((t) => t.audience === 'member'))
    assert.ok(suggested.some((t) => t.name === 'AlphaMD Provider, Secondary Follow-Up'))
  })

  it('suggests initial consultations for someone not yet a patient', () => {
    const { suggested } = eventTypesFor({ statusId: 3, gender: 'male' })
    assert.ok(suggested.every((t) => t.audience === 'non_member'))
  })

  it('offers the female variants for a female patient and not the male ones', () => {
    const { suggested } = eventTypesFor({ statusId: 8, gender: 'Female' })
    assert.ok(suggested.some((t) => t.gender === 'female'))
    assert.ok(!suggested.some((t) => t.gender === 'male'))
  })

  it('accepts "f" as female, which is how it is often recorded', () => {
    const forF = eventTypesFor({ statusId: 8, gender: 'f' })
    const forFemale = eventTypesFor({ statusId: 8, gender: 'female' })
    assert.deepEqual(forF.suggested, forFemale.suggested)
  })

  it('defaults to male when gender is blank rather than offering nothing', () => {
    const { suggested } = eventTypesFor({ statusId: 8, gender: null })
    assert.ok(suggested.length > 0)
    assert.ok(!suggested.some((t) => t.gender === 'female'))
  })

  it('keeps gender-neutral types in the suggested list for either patient', () => {
    for (const gender of ['male', 'female']) {
      const { suggested } = eventTypesFor({ statusId: 8, gender })
      assert.ok(suggested.some((t) => t.name.includes('Medical Weight Loss')))
    }
  })

  it('hides nothing — every type is in one list or the other', () => {
    const { suggested, other } = eventTypesFor({ statusId: 8, gender: 'male' })
    assert.equal(suggested.length + other.length, CONSULTATION_EVENT_TYPES.length)
    assert.equal(new Set([...suggested, ...other]).size, CONSULTATION_EVENT_TYPES.length)
  })
})
