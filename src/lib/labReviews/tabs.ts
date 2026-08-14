import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { consultationOutcome, type Consultation } from './consultations'
import { classifyFile, displayFileName, fileKindLabel } from './files'
import type { Note, NoteTag } from './notes'
import { orderContentLines, type OrderLine } from './orders'
import { namesFor } from './queries'
import { getLabFileMimeTypes } from './storage'

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
  /** `orders.id` is a uuid, unlike the bigint ids on every other tab's table. */
  id: string
  orderNumber: string | null
  pharmacy: string | null
  status: string | null
  orderDate: string | null
  contents: OrderLine[]
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
 *
 * What was ordered lives in `additional_information` — see `orders.ts`. There is
 * no line-item table to join.
 */
export async function getOrders(patientId: string): Promise<Order[]> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('orders')
    .select(
      'id, order_number, pharmacy, other_pharmacy, order_status, order_date, created_at, additional_information'
    )
    .eq('patient_id', patientId)
    .order('order_date', { ascending: false, nullsFirst: false })
    .limit(50)
  if (error) throw new Error(`orders query failed: ${error.message}`)

  return (data ?? []).map((r) => ({
    id: String(r.id),
    orderNumber: (r.order_number as string | null)?.trim() || null,
    pharmacy:
      (r.pharmacy as string | null)?.trim() || (r.other_pharmacy as string | null)?.trim() || null,
    status: (r.order_status as string | null)?.trim() || null,
    orderDate: (r.order_date as string | null) ?? (r.created_at as string | null) ?? null,
    contents: orderContentLines(r.additional_information as string | null),
  }))
}

export type PatientFile = {
  id: number
  path: string
  name: string
  /** From bucket metadata, not the path — the stored extension lies. Null when
   *  the object has no metadata or the lookup failed. */
  mimeType: string | null
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

  const rows = (data ?? []).filter((r) => !!r.file_name)
  const mimeTypes = await getLabFileMimeTypes(rows.map((r) => r.file_name as string))

  return rows.map((r) => {
    const path = r.file_name as string
    const mimeType = mimeTypes.get(path) ?? null
    return {
      id: Number(r.id),
      path,
      name: displayFileName(path, r.user_file_name as string | null, mimeType),
      mimeType,
      kind: classifyFile(path, mimeType),
      kindLabel: fileKindLabel(path, mimeType),
      description: (r.description as string | null)?.trim() || null,
      createdAt: (r.created_at as string | null) ?? null,
    }
  })
}

/** Who wrote a message. `PROVIDER` is a staff author holding role 3, the same
 *  test the Notes tab uses, so the two tabs agree on who is a provider. */
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
  /** Oldest first, the order the conversation happened in. */
  messages: CsMessage[]
  lastActivityAt: string | null
  unreadCount: number
}

export type CsInbox = {
  /** Most recently active first. */
  threads: CsThread[]
  unreadCount: number
}

const NO_MESSAGES: CsInbox = { threads: [], unreadCount: 0 }

/**
 * Every Zendesk thread for a patient, grouped by ticket.
 *
 * This is a **database read**, not a Zendesk API call — `zendesk_last_contact`
 * is a full comment mirror (70k+ rows) maintained by a webhook Zendesk fires at
 * alphamd. Only sending needs the API.
 *
 * Three things it has to get right:
 *  - 22% of comments have `is_public = false`. Those are internal staff notes
 *    the patient never saw, and the UI must mark them, or a provider will
 *    believe the patient read something they did not.
 *  - Patients average 5.5 tickets and the busiest real account has 65, so a
 *    single flattened transcript would interleave unrelated conversations.
 *  - `is_staff` alone cannot tell a provider from support. `staff_user_id` is
 *    set on 78% of staff comments and resolves through `user_roles_join`; the
 *    remainder are honestly labelled STAFF rather than guessed at.
 *
 * The 500-row ceiling is a safety net, not a real limit: the busiest patient
 * has 192 comments.
 */
export async function getCsThreads(patientId: string, readerId: string): Promise<CsInbox> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('zendesk_last_contact')
    .select(
      'id, ticket_id, subject, message, is_public, is_staff, staff_user_id, requester_name, attachments, created_at'
    )
    .eq('user_id', patientId)
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(`zendesk_last_contact query failed: ${error.message}`)

  const rows = (data ?? []).filter((r) => r.ticket_id)
  if (!rows.length) return NO_MESSAGES

  const ticketIds = [...new Set(rows.map((r) => r.ticket_id as string))]
  const staffIds = [
    ...new Set(rows.map((r) => r.staff_user_id as string | null).filter(Boolean) as string[]),
  ]

  const [reads, roles] = await Promise.all([
    admin
      .from('zendesk_ticket_reads')
      .select('ticket_id, last_read_at')
      .eq('user_id', readerId)
      .in('ticket_id', ticketIds),
    staffIds.length
      ? admin.from('user_roles_join').select('user_id, role').in('user_id', staffIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (reads.error) throw new Error(`zendesk_ticket_reads query failed: ${reads.error.message}`)
  if (roles.error) throw new Error(`message author roles lookup failed: ${roles.error.message}`)

  const readAtByTicket = new Map(
    (reads.data ?? []).map((r) => [r.ticket_id as string, r.last_read_at as string | null])
  )
  const providerIds = new Set(
    (roles.data ?? [])
      .filter((r) => Number(r.role) === 3)
      .map((r) => r.user_id as string)
  )

  const byTicket = new Map<string, CsThread>()

  // Rows arrive newest-first; each thread's messages are reversed below.
  for (const r of rows) {
    const ticketId = r.ticket_id as string
    const staffUserId = r.staff_user_id as string | null

    let role: CsAuthorRole = 'PATIENT'
    if (r.is_staff) role = staffUserId && providerIds.has(staffUserId) ? 'PROVIDER' : 'STAFF'

    const message: CsMessage = {
      id: Number(r.id),
      author:
        (r.requester_name as string | null)?.trim() || (r.is_staff ? 'Care team' : 'Patient'),
      role,
      isPublic: r.is_public !== false,
      message: (r.message as string | null) ?? '',
      createdAt: (r.created_at as string | null) ?? null,
      attachmentCount: Array.isArray(r.attachments) ? r.attachments.length : 0,
    }

    const existing = byTicket.get(ticketId)
    if (existing) {
      existing.messages.push(message)
      continue
    }

    byTicket.set(ticketId, {
      ticketId,
      // The first row for a ticket is its newest, so this is the latest activity.
      lastActivityAt: message.createdAt,
      subject: (r.subject as string | null)?.trim() || `Ticket ${ticketId}`,
      messages: [message],
      unreadCount: 0,
    })
  }

  const threads = [...byTicket.values()].map((thread) => {
    thread.messages.reverse()

    // Unread = patient messages the reader has not acknowledged. With no
    // receipt at all, report zero rather than marking a year of history unread.
    const lastReadAt = readAtByTicket.get(thread.ticketId) ?? null
    thread.unreadCount = lastReadAt
      ? thread.messages.filter(
          (m) =>
            m.role === 'PATIENT' && m.createdAt && new Date(m.createdAt) > new Date(lastReadAt)
        ).length
      : 0

    return thread
  })

  return {
    threads,
    unreadCount: threads.reduce((total, thread) => total + thread.unreadCount, 0),
  }
}

/**
 * Every consultation booked for a patient, newest first.
 *
 * `user_consultation_schedules.user_id` is the **patient**; `medical_provider`
 * is the staff member who took the call, and it holds ids outside the current
 * provider roster — 11 distinct values against 10 accounts holding role 3 — so
 * names are resolved from `user_list` generally rather than from providers.
 *
 * Ordering by start time descending puts anything still upcoming at the top for
 * free, because those are the only rows dated in the future. What each status
 * value actually means, and why attendance is not inferred from it, is in
 * `consultations.ts`.
 */
export async function getConsultations(patientId: string): Promise<Consultation[]> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('user_consultation_schedules')
    .select(
      'id, event_start_time, event_end_time, event_status, event_name, medical_provider, timezone'
    )
    .eq('user_id', patientId)
    .order('event_start_time', { ascending: false, nullsFirst: false })
    .limit(50)
  if (error) {
    throw new Error(`user_consultation_schedules query failed: ${error.message}`)
  }

  const rows = data ?? []
  if (!rows.length) return []

  const providerIds = rows
    .map((r) => r.medical_provider as string | null)
    .filter(Boolean) as string[]
  const providerNames = await namesFor(providerIds, 'Unnamed provider')

  const now = new Date()

  return rows.map((r) => {
    const providerId = r.medical_provider as string | null
    const startsAt = (r.event_start_time as string | null) ?? null

    return {
      id: String(r.id),
      startsAt,
      endsAt: (r.event_end_time as string | null) ?? null,
      name: (r.event_name as string | null)?.trim() || null,
      providerName: providerId ? (providerNames.get(providerId) ?? null) : null,
      timezone: (r.timezone as string | null)?.trim() || null,
      outcome: consultationOutcome(r.event_status as string | null, startsAt, now),
    }
  })
}
