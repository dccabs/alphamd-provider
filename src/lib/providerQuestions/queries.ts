import 'server-only'

import { contactsFor, listFlagsFor, listPatientStatuses } from '@/lib/labReviews/queries'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseAnswerDraft, type AnswerDraft } from './answerDraft'
import {
  isProviderQuestionStatus,
  type ProviderQuestionRow,
  type ProviderQuestionStatus,
} from './queueRow'

/**
 * Reads for the Provider Question pile and review screen.
 *
 * Service-role client throughout, like `labReviews/queries`: `provider_questions`
 * is RLS-gated to staff roles by `user_list.role`, which providers do not hold
 * reliably. Callers must run `checkProviderAccess()` first.
 */

const ROW_SELECT =
  'id, patient_id, status, question, cs_comments, urgent, assigned_to, zendesk_ticket_id, created_by, created_at, started_at, finished_at, finished_by, answer, resolution, note_id, cs_action_id, draft, draft_updated_at'

type DbRow = {
  id: string
  patient_id: string
  status: string
  question: string
  cs_comments: string | null
  urgent: boolean
  assigned_to: string | null
  zendesk_ticket_id: string | null
  created_by: string
  created_at: string | null
  started_at: string | null
  finished_at: string | null
  finished_by: string | null
  answer: string | null
  resolution: string | null
  note_id: number | null
  cs_action_id: string | null
  draft: unknown
  draft_updated_at: string | null
}

/** Pile order: Urgent first, then oldest first — the pile is worked from the
 *  back, unlike Lab Reviews which surface the freshest labs. */
function orderPile<T extends { order: (col: string, opts: object) => T }>(query: T): T {
  return query
    .order('urgent', { ascending: false })
    .order('created_at', { ascending: true, nullsFirst: false })
}

function statusOf(value: string): ProviderQuestionStatus {
  return isProviderQuestionStatus(value) ? value : 'queued'
}

/**
 * The prescribing provider per patient: whoever signed the most recent order.
 * That is the definition alphamd already uses on the Lab Review report
 * (`labReviewReportEnrichment`). Shown on the row, never the Question Assignee.
 *
 * `orders.prescription_signer` is a `user_list.user_id` on recent rows and a
 * free-text name on older ones, so ids are resolved and anything else is shown
 * as written.
 */
async function prescribingProvidersFor(patientIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(patientIds.filter(Boolean))]
  if (!unique.length) return new Map()

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('orders')
    .select('patient_id, prescription_signer, created_at')
    .in('patient_id', unique)
    .not('prescription_signer', 'is', null)
    .order('created_at', { ascending: false })
  // A missing prescriber is worth losing; a pile page is not.
  if (error) return new Map()

  const latest = new Map<string, string>()
  for (const row of data ?? []) {
    const patientId = row.patient_id as string
    const signer = (row.prescription_signer as string | null)?.trim()
    if (!signer || latest.has(patientId)) continue
    latest.set(patientId, signer)
  }

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const ids = [...latest.values()].filter((v) => UUID.test(v))
  const names = ids.length ? await contactsFor(ids, 'Unnamed provider') : new Map()

  const out = new Map<string, string>()
  for (const [patientId, signer] of latest) {
    out.set(patientId, UUID.test(signer) ? (names.get(signer)?.name ?? signer) : signer)
  }
  return out
}

/** Open Provider Questions per patient, counted across the whole table so the
 *  note is right even when the page is filtered to one status. */
async function openCountsFor(patientIds: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(patientIds.filter(Boolean))]
  if (!unique.length) return new Map()

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('provider_questions')
    .select('patient_id')
    .in('patient_id', unique)
    .neq('status', 'finished')
  if (error) throw new Error(`provider_questions count failed: ${error.message}`)

  const out = new Map<string, number>()
  for (const row of data ?? []) {
    const id = row.patient_id as string
    out.set(id, (out.get(id) ?? 0) + 1)
  }
  return out
}

async function hydrate(rows: DbRow[]): Promise<ProviderQuestionRow[]> {
  if (!rows.length) return []

  const patientIds = rows.map((r) => r.patient_id)
  const staffIds = [
    ...rows.map((r) => r.assigned_to),
    ...rows.map((r) => r.finished_by),
  ].filter(Boolean) as string[]

  const [contacts, flags, statuses, prescribers, openCounts] = await Promise.all([
    contactsFor([...patientIds, ...staffIds]),
    listFlagsFor(patientIds),
    listPatientStatuses(patientIds),
    prescribingProvidersFor(patientIds),
    openCountsFor(patientIds),
  ])

  return rows.map((r) => ({
    id: r.id,
    patientId: r.patient_id,
    patientName: contacts.get(r.patient_id)?.name ?? 'Unknown patient',
    patientEmail: contacts.get(r.patient_id)?.email ?? null,
    patientStatus: statuses.get(r.patient_id) ?? null,
    prescribingProviderName: prescribers.get(r.patient_id) ?? null,
    status: statusOf(r.status),
    question: r.question,
    csComments: r.cs_comments,
    urgent: Boolean(r.urgent),
    assignedTo: r.assigned_to,
    assignedToName: r.assigned_to ? (contacts.get(r.assigned_to)?.name ?? null) : null,
    zendeskTicketId: r.zendesk_ticket_id,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    finishedByName: r.finished_by ? (contacts.get(r.finished_by)?.name ?? null) : null,
    resolution: r.resolution,
    openCountForPatient: openCounts.get(r.patient_id) ?? 0,
    flags: flags.get(r.patient_id) ?? [],
  }))
}

/** The pile: every Open Provider Question, Urgent first then oldest first. */
export async function listOpenProviderQuestions(): Promise<ProviderQuestionRow[]> {
  const admin = createAdminClient()

  const { data, error } = await orderPile(
    admin.from('provider_questions').select(ROW_SELECT).neq('status', 'finished')
  )
  if (error) throw new Error(`provider_questions query failed: ${error.message}`)

  return hydrate((data ?? []) as DbRow[])
}

/** Finished Provider Questions, most recently finished first. */
export async function listFinishedProviderQuestions(limit = 100): Promise<ProviderQuestionRow[]> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('provider_questions')
    .select(ROW_SELECT)
    .eq('status', 'finished')
    .order('finished_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw new Error(`provider_questions query failed: ${error.message}`)

  return hydrate((data ?? []) as DbRow[])
}

export type ProviderQuestionDetail = ProviderQuestionRow & {
  answer: string | null
  noteId: number | null
  csActionId: string | null
  createdByName: string | null
  /** The answer flyout's autosave, already validated. */
  draft: AnswerDraft
  draftUpdatedAt: string | null
}

export async function getProviderQuestion(id: string): Promise<ProviderQuestionDetail | null> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('provider_questions')
    .select(ROW_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`provider_questions lookup failed: ${error.message}`)
  if (!data) return null

  const db = data as DbRow
  const [[row], creator] = await Promise.all([hydrate([db]), contactsFor([db.created_by])])

  return {
    ...row,
    answer: db.answer,
    noteId: db.note_id,
    csActionId: db.cs_action_id,
    createdByName: creator.get(db.created_by)?.name ?? null,
    draft: parseAnswerDraft(db.draft),
    draftUpdatedAt: db.draft_updated_at,
  }
}