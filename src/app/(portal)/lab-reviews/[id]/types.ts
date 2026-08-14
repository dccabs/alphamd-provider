/**
 * Plain data shapes passed from the server page down into client components.
 *
 * These are re-declared here rather than imported from `@/lib/labReviews/tabs`
 * because that module is `server-only` — importing it from a `'use client'`
 * file would pull the service-role client toward the browser bundle, which is
 * a build error by design.
 */

import type { OrderLine } from '@/lib/labReviews/orders'

export type FileKind = 'pdf' | 'image' | 'unsupported'

export type PatientFile = {
  id: number
  path: string
  name: string
  /** From bucket metadata, not the path — the stored extension lies. */
  mimeType: string | null
  kind: FileKind
  kindLabel: string
  description: string | null
  createdAt: string | null
}

export type Medication = {
  id: number
  /** `medications_list.id`, which the dosing options are keyed by. */
  medicationId: number
  name: string
  type: string | null
  dosage: string | null
  pharmacy: string | null
  expiration: string | null
  active: boolean
  startedAt: string | null
}

/** One dose from `medication_dosage`, grouped by `medicationId`. */
export type DosageOption = {
  medicationId: number
  id: number
  value: string
}

/** A `medications_list` row a protocol can be added to. Restricted medications
 *  are already filtered out server-side. */
export type CatalogMedication = {
  id: number
  name: string
  type: string | null
}

export type Order = {
  /** `orders.id` is a uuid, unlike the bigint ids on every other tab's table. */
  id: string
  orderNumber: string | null
  pharmacy: string | null
  status: string | null
  orderDate: string | null
  contents: OrderLine[]
}

export type CsAuthorRole = 'PATIENT' | 'PROVIDER' | 'STAFF'

export type CsMessage = {
  id: number
  author: string
  role: CsAuthorRole
  isPublic: boolean
  message: string
  createdAt: string | null
  attachmentCount: number
}

export type CsThread = {
  ticketId: string
  subject: string
  messages: CsMessage[]
  lastActivityAt: string | null
  unreadCount: number
}

export type CsInbox = {
  threads: CsThread[]
  unreadCount: number
}

/** One entry from `lab_review_events`. The actor name is the denormalised copy
 *  recorded at the time, not a live lookup — see `labReviews/events.ts`. */
export type LabReviewEvent = {
  id: string
  createdAt: string | null
  eventType: string
  actorName: string | null
  actorRole: string | null
  summary: string | null
  fromStatus: string | null
  toStatus: string | null
}

/** A note *about the review* rather than about the patient — a handoff reason,
 *  not chart content. See `labReviews/events.ts`. */
export type LabReviewNote = {
  id: string
  createdAt: string | null
  authorName: string | null
  note: string
  kind: string
  aiAssisted: boolean
}

/** A provider a review can be handed to. */
export type ProviderOption = {
  userId: string
  name: string
}
