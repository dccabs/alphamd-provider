/**
 * Plain data shapes passed from the server page down into client components.
 *
 * These are re-declared here rather than imported from `@/lib/labReviews/tabs`
 * because that module is `server-only` — importing it from a `'use client'`
 * file would pull the service-role client toward the browser bundle, which is
 * a build error by design.
 */

export type FileKind = 'pdf' | 'image' | 'unsupported'

export type PatientFile = {
  id: number
  path: string
  name: string
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
  id: number
  orderNumber: string | null
  pharmacy: string | null
  status: string | null
  orderDate: string | null
  trackingNumber: string | null
  shippingCarrier: string | null
}

export type CsComment = {
  id: number
  commentId: string | null
  author: string
  isStaff: boolean
  isPublic: boolean
  message: string
  createdAt: string | null
  attachmentCount: number
}

export type CsThread = {
  ticketId: string | null
  subject: string | null
  comments: CsComment[]
  unreadCount: number
  totalTickets: number
  lastReadAt: string | null
}
