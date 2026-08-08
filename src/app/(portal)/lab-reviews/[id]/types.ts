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
  name: string
  type: string | null
  dosage: string | null
  pharmacy: string | null
  expiration: string | null
  active: boolean
  startedAt: string | null
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
