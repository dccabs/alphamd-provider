import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { classifyFile, displayFileName, fileKindLabel } from './files'
import type { Note, NoteTag } from './notes'

/** Right-rail tab data. Same rule as queries.ts: callers run
 *  `requireProviderAccess()` first. */

export async function getNotes(patientId: string): Promise<Note[]> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('patient_notes_private')
    .select('id, created_at, created_by, note, is_internal_only, is_official_visit')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`patient_notes_private query failed: ${error.message}`)

  const rows = data ?? []
  if (!rows.length) return []

  const authorIds = [...new Set(rows.map((r) => r.created_by as string).filter(Boolean))]

  const [people, roles] = await Promise.all([
    admin.from('user_list').select('user_id, first_name, last_name').in('user_id', authorIds),
    admin.from('user_roles_join').select('user_id, role').in('user_id', authorIds),
  ])
  if (people.error) throw new Error(`note author lookup failed: ${people.error.message}`)
  if (roles.error) throw new Error(`note author roles lookup failed: ${roles.error.message}`)

  const nameById = new Map(
    (people.data ?? []).map((p) => [
      p.user_id as string,
      [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'Unknown',
    ])
  )
  const rolesById = new Map<string, Set<number>>()
  for (const r of roles.data ?? []) {
    const key = r.user_id as string
    if (!rolesById.has(key)) rolesById.set(key, new Set())
    rolesById.get(key)!.add(Number(r.role))
  }

  return rows.map((r) => {
    const authorId = r.created_by as string
    const authorRoles = rolesById.get(authorId) ?? new Set<number>()

    let tag: NoteTag
    if (r.is_internal_only) tag = 'INTERNAL'
    else if (authorRoles.has(3)) tag = 'PROVIDER'
    else if (authorId === patientId) tag = 'PATIENT'
    else if (authorRoles.size > 0) tag = 'STAFF'
    else tag = 'SYSTEM'

    return {
      id: Number(r.id),
      author: nameById.get(authorId) ?? 'System',
      tag,
      createdAt: (r.created_at as string | null) ?? null,
      note: (r.note as string | null) ?? '',
      isOfficialVisit: Boolean(r.is_official_visit),
    }
  })
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

/**
 * **`orders.patient_id` is the patient, not `orders.user_id`.**
 *
 * Measured on production: `orders.user_id` has 9 distinct values across 17,848
 * rows and every one resolves to a staff account — it is the person who created
 * the order. `patient_id` has 3,140 distinct values. Querying `user_id` here
 * would return an empty Orders tab for every patient, silently, because RLS is
 * bypassed and an empty result is indistinguishable from "no orders".
 *
 * This is the opposite of `patient_medications`, `user_files` and
 * `zendesk_last_contact`, where `user_id` *is* the patient.
 */
export async function getOrders(patientId: string): Promise<Order[]> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('orders')
    .select(
      'id, order_number, pharmacy, other_pharmacy, order_status, order_date, created_at, tracking_number, shipping_carrier, other_shipping_carrier'
    )
    .eq('patient_id', patientId)
    .order('order_date', { ascending: false, nullsFirst: false })
    .limit(50)
  if (error) throw new Error(`orders query failed: ${error.message}`)

  return (data ?? []).map((r) => ({
    id: Number(r.id),
    orderNumber: (r.order_number as string | null)?.trim() || null,
    pharmacy:
      (r.pharmacy as string | null)?.trim() || (r.other_pharmacy as string | null)?.trim() || null,
    status: (r.order_status as string | null)?.trim() || null,
    orderDate: (r.order_date as string | null) ?? (r.created_at as string | null) ?? null,
    trackingNumber: (r.tracking_number as string | null)?.trim() || null,
    shippingCarrier:
      (r.shipping_carrier as string | null)?.trim() ||
      (r.other_shipping_carrier as string | null)?.trim() ||
      null,
  }))
}

export type PatientFile = {
  id: number
  path: string
  name: string
  kind: ReturnType<typeof classifyFile>
  kindLabel: string
  description: string | null
  createdAt: string | null
}

export async function getFiles(patientId: string): Promise<PatientFile[]> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('user_files')
    .select('id, file_name, user_file_name, description, created_at')
    .eq('user_id', patientId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`user_files query failed: ${error.message}`)

  return (data ?? [])
    .filter((r) => !!r.file_name)
    .map((r) => {
      const path = r.file_name as string
      return {
        id: Number(r.id),
        path,
        name: displayFileName(path, r.user_file_name as string | null),
        kind: classifyFile(path),
        kindLabel: fileKindLabel(path),
        description: (r.description as string | null)?.trim() || null,
        createdAt: (r.created_at as string | null) ?? null,
      }
    })
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

/**
 * The CS thread is a **database read**, not a Zendesk API call —
 * `zendesk_last_contact` is a full comment mirror (70k+ rows, a year of
 * history) maintained by a webhook Zendesk fires at alphamd. Only sending needs
 * the API.
 *
 * Two things this has to get right:
 *  - 22% of comments have `is_public = false`. Those are internal staff notes
 *    the patient never saw, and the UI must mark them, or a provider will
 *    believe the patient read something they did not.
 *  - The average patient has 4.8 tickets and the maximum is 65, while the
 *    design shows one thread. We show the ticket holding the most recent
 *    comment and state which one it is; `totalTickets` lets the UI say so.
 */
export async function getCsThread(patientId: string, readerId: string): Promise<CsThread> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('zendesk_last_contact')
    .select(
      'id, ticket_id, comment_id, subject, message, is_public, is_staff, requester_name, attachments, created_at'
    )
    .eq('user_id', patientId)
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(`zendesk_last_contact query failed: ${error.message}`)

  const rows = data ?? []
  if (!rows.length) {
    return {
      ticketId: null,
      subject: null,
      comments: [],
      unreadCount: 0,
      totalTickets: 0,
      lastReadAt: null,
    }
  }

  const totalTickets = new Set(rows.map((r) => r.ticket_id as string).filter(Boolean)).size
  // Rows are newest-first, so the first row's ticket is the most recently active.
  const ticketId = (rows.find((r) => r.ticket_id)?.ticket_id as string | null) ?? null

  const threadRows = rows.filter((r) => r.ticket_id === ticketId)

  const { data: readRow, error: readError } = await admin
    .from('zendesk_ticket_reads')
    .select('last_read_at')
    .eq('user_id', readerId)
    .eq('ticket_id', ticketId ?? '')
    .maybeSingle()
  if (readError) throw new Error(`zendesk_ticket_reads query failed: ${readError.message}`)

  const lastReadAt = (readRow?.last_read_at as string | null) ?? null

  const comments: CsComment[] = threadRows
    .map((r) => {
      const attachments = r.attachments
      return {
        id: Number(r.id),
        commentId: (r.comment_id as string | null) ?? null,
        author: (r.requester_name as string | null)?.trim() || (r.is_staff ? 'Care team' : 'Patient'),
        isStaff: Boolean(r.is_staff),
        isPublic: r.is_public !== false,
        message: (r.message as string | null) ?? '',
        createdAt: (r.created_at as string | null) ?? null,
        attachmentCount: Array.isArray(attachments) ? attachments.length : 0,
      }
    })
    // Oldest first for a chat transcript.
    .reverse()

  // Unread = patient-authored public comments newer than this reader's receipt.
  // With no receipt row at all, report zero rather than marking a year of
  // history unread.
  const unreadCount = lastReadAt
    ? comments.filter(
        (c) => !c.isStaff && c.createdAt && new Date(c.createdAt) > new Date(lastReadAt)
      ).length
    : 0

  return {
    ticketId,
    subject: (threadRows.find((r) => r.subject)?.subject as string | null) ?? null,
    comments,
    unreadCount,
    totalTickets,
    lastReadAt,
  }
}
