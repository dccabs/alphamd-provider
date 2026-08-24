/**
 * The Calendly event types a provider can invite a patient to book.
 *
 * Ported from the hardcoded `CONSULTATION_EVENT_TYPES` in the main app's
 * `SendConsultationLinkModal`. The UUIDs are live Calendly event types — a wrong
 * one sends the patient to the wrong appointment with the wrong provider, so they
 * are copied, never retyped.
 *
 * The main app keeps four separate copies of this list (the staff modal, the admin
 * reschedule util, and two API routes) which have already drifted apart — the same
 * provider appears under different UUIDs in different places. This is a fifth
 * copy, so it is worth stating plainly: **if Calendly's event types change, this
 * file has to change with them, and nothing will fail loudly if it does not.**
 * Only the list the staff modal uses is ported, because that is the one this
 * screen's job matches.
 */

export type ConsultationEventType = {
  id: string
  name: string
  /** Minutes, for the provider's benefit when choosing. */
  duration: number
  /** Which patients this is appropriate for. */
  audience: 'member' | 'non_member'
  /** `null` means it suits either. */
  gender: 'male' | 'female' | null
  /** Named after a specific clinician rather than the practice. */
  namedProvider?: string
}

export const CONSULTATION_EVENT_TYPES: ConsultationEventType[] = [
  {
    id: '2d7a15dd-4c53-479b-b8ff-d26c508f4995',
    name: 'AlphaMD Provider, Secondary Follow-Up',
    duration: 15,
    audience: 'member',
    gender: 'male',
  },
  {
    id: '3100b91f-d43d-4893-b096-34b8c774a1c6',
    name: 'AlphaMD Provider, Female Secondary Follow-Up',
    duration: 15,
    audience: 'member',
    gender: 'female',
  },
  {
    id: '3a5c7947-12bf-4327-8480-6a8f1dabe468',
    name: 'AlphaMD Medical Weight Loss Consultation',
    duration: 15,
    audience: 'member',
    gender: null,
  },
  {
    id: 'f2d57860-5ffa-4439-b0c3-a5505fd60bb2',
    name: 'Trace Owens, Secondary Follow-Up',
    duration: 15,
    audience: 'member',
    gender: 'male',
    namedProvider: 'Trace Owens',
  },
  {
    id: '972b2cb4-8431-4699-b35f-4713650f5e68',
    name: 'AlphaMD Video Consultation - Dr. Alexis McDonald',
    duration: 15,
    audience: 'member',
    gender: 'female',
    namedProvider: 'Dr. Alexis McDonald',
  },
  {
    id: '471ed402-56ae-488a-a532-4d97cb9ae38f',
    name: 'AlphaMD Video Consultation - Saba Haq MD',
    duration: 15,
    audience: 'member',
    gender: null,
    namedProvider: 'Saba Haq MD',
  },
  {
    id: '0d9a26a2-2484-4372-97a9-a9a991e0abc8',
    name: 'AlphaMD Video Consultation - Dr. Jeffrey Bailey',
    duration: 15,
    audience: 'member',
    gender: 'male',
    namedProvider: 'Dr. Jeffrey Bailey',
  },
  {
    id: '9bceb189-bcb5-4d72-8872-25825a7669de',
    name: 'AlphaMD Video Consultation - Jake Swanson',
    duration: 15,
    audience: 'member',
    gender: 'male',
    namedProvider: 'Jake Swanson',
  },
  {
    id: '89af9951-1b5c-4ee1-a193-fdbe27044671',
    name: 'AlphaMD Initial Video Consultation (No Test Results)',
    duration: 15,
    audience: 'non_member',
    gender: 'male',
  },
  {
    id: '893290ab-b7ab-46f0-b9a6-b1359b71d96c',
    name: 'AlphaMD Video Consultation',
    duration: 15,
    audience: 'non_member',
    gender: 'male',
  },
  {
    id: '301dd3aa-32a0-4836-bf36-14d0f7086cdd',
    name: 'AlphaMD Female TRT Video Consultation (No Test Results)',
    duration: 15,
    audience: 'non_member',
    gender: 'female',
  },
  {
    id: 'cde36256-be78-4e90-b6bb-25b94f3a7f3f',
    name: 'AlphaMD Female TRT Video Consultation',
    duration: 15,
    audience: 'non_member',
    gender: 'female',
  },
]

export function eventTypeById(id: string): ConsultationEventType | undefined {
  return CONSULTATION_EVENT_TYPES.find((t) => t.id === id)
}

/**
 * `user_list.status` values that mean an active subscription, copied from the main
 * app's `ACTIVE_STATUS_IDS`. Verified against `user_statuses`: 8 "Patient, Active
 * Subscription", 12–14 the weight-loss and combined plans, 17 ancillary
 * medications only.
 */
const ACTIVE_MEMBER_STATUSES = [8, 12, 13, 14, 17]

export function isActiveMember(statusId: number | null): boolean {
  return statusId !== null && ACTIVE_MEMBER_STATUSES.includes(statusId)
}

function isFemale(gender: string | null | undefined): boolean {
  const value = (gender ?? '').trim().toLowerCase()
  return value === 'female' || value === 'f'
}

/**
 * The event types to offer, most appropriate first.
 *
 * Nothing is *hidden* — every type stays reachable, ordered rather than filtered.
 * The main app collapses the wrong-audience list behind a disclosure, and the
 * reason to keep them reachable is the same: patient status and recorded gender are
 * both often stale or blank, and a provider who knows the patient should not be
 * blocked by a status field that disagrees.
 *
 * `suggest` overrides the status-based audience. A Lab Review already has
 * results, so that screen asks for follow-ups even when the Patient is still
 * Onboarding — an "Initial (No Test Results)" slot is the wrong offer there.
 *
 * `suggested` is what the UI groups on.
 */
export function eventTypesFor(patient: {
  statusId: number | null
  gender: string | null
  suggest?: 'follow_up' | 'initial' | 'by_status'
}): { suggested: ConsultationEventType[]; other: ConsultationEventType[] } {
  const audience =
    patient.suggest === 'follow_up'
      ? 'member'
      : patient.suggest === 'initial'
        ? 'non_member'
        : isActiveMember(patient.statusId)
          ? 'member'
          : 'non_member'
  const female = isFemale(patient.gender)
  const wantedGender = female ? 'female' : 'male'

  const fits = (type: ConsultationEventType) =>
    type.audience === audience && (type.gender === null || type.gender === wantedGender)

  return {
    suggested: CONSULTATION_EVENT_TYPES.filter(fits),
    other: CONSULTATION_EVENT_TYPES.filter((type) => !fits(type)),
  }
}
