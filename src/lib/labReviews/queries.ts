import 'server-only'

import { ROLE } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  latestCollection,
  orderAnalytes,
  type Analyte,
  type AnalyteCollection,
} from './analytes'
import { RESTRICTED_MEDICATION_IDS } from './clinicalIds'
import { parseDraft, type ReviewDraft } from './reviewDraft'

/**
 * Reads for the lab-review queue and detail screens.
 *
 * Everything here goes through the service-role client because every table
 * involved is gated by RLS on `is_admin_or_employee()`, which no provider
 * satisfies. Callers must run `requireProviderAccess()` first — see
 * `@/lib/authz`.
 */

export const LAB_REVIEW_STATUSES = ['active', 'needs_attention', 'finished'] as const
export type LabReviewStatus = (typeof LAB_REVIEW_STATUSES)[number]

export function isLabReviewStatus(value: string | undefined): value is LabReviewStatus {
  return !!value && (LAB_REVIEW_STATUSES as readonly string[]).includes(value)
}

export type QueueRow = {
  id: string
  patientId: string
  patientName: string
  status: string
  summaryStatus: string | null
  assignedTo: string | null
  assignedToName: string | null
  lastSourceAt: string | null
  createdAt: string | null
  sourceKinds: string[]
  flags: string[]
}

export type LabReviewDetail = {
  id: string
  patientId: string
  status: string
  summaryStatus: string | null
  summaryError: string | null
  assignedTo: string | null
  assignedToName: string | null
  /** Set on the *first* start and never overwritten — see `startLabReview`. */
  startedAt: string | null
  startedByName: string | null
  /** Autosaved work in progress. Always a valid draft: `parseDraft` degrades a
   *  malformed column to an empty one rather than throwing. */
  draft: ReviewDraft
  draftUpdatedAt: string | null
  resolution: string | null
  reviewedAt: string | null
  needsAttentionReason: string | null
  lastSourceAt: string | null
  createdAt: string | null
  queuePosition: number | null
  queueTotal: number
  report: LabReviewReport | null
  sources: LabReviewSource[]
}

export type ProviderOption = {
  userId: string
  name: string
}

/**
 * Who a review may be handed to.
 *
 * Role 3 in `user_roles_join`, matching `checkProviderAccess` — 10 accounts in
 * production. `user_list.role` is not consulted, for the reason in the README.
 */
export async function listProviders(): Promise<ProviderOption[]> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('user_roles_join')
    .select('user_id')
    .eq('role', ROLE.provider)
  if (error) throw new Error(`provider lookup failed: ${error.message}`)

  const ids = [...new Set((data ?? []).map((r) => r.user_id as string).filter(Boolean))]
  if (!ids.length) return []

  const names = await namesFor(ids, 'Unnamed provider')

  return ids
    .map((userId) => ({ userId, name: names.get(userId) ?? 'Unnamed provider' }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export type LabReviewReport = {
  id: string
  patientName: string | null
  patientSummary: string | null
  createdAt: string | null
  /** The latest collection's values only. Older collections are read to find it
   *  and then dropped: a retest arrives as its own collection beside the panel it
   *  followed, and showing both invites reading a stale value as the current one. */
  analytes: Analyte[]
  collectionDate: string | null
  sourceFileName: string | null
}

export type LabReviewSource = {
  id: number
  source: string
  filePath: string | null
  occurredAt: string | null
}

/** Queue ordering, used by both the list page and the "Review N of M" pill.
 *  They must agree, so this is the single definition. */
function orderQueue<T extends { order: (col: string, opts: object) => T }>(query: T): T {
  return query
    .order('last_source_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false, nullsFirst: false })
}

type NameRow = { user_id: string | null; first_name: string | null; last_name: string | null }

function fullName(row: NameRow | undefined, fallback = 'Unknown patient'): string {
  if (!row) return fallback
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
  return name || fallback
}

/** Display names for a set of user ids. Ids with no `user_list` row are absent
 *  from the map rather than present with a placeholder, so callers can tell
 *  "nobody recorded" from "recorded but unnamed". */
export async function namesFor(
  userIds: string[],
  fallback = 'Unknown patient'
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))]
  if (!unique.length) return new Map()

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('user_list')
    .select('user_id, first_name, last_name')
    .in('user_id', unique)
  if (error) throw new Error(`user_list lookup failed: ${error.message}`)

  return new Map((data ?? []).map((r) => [r.user_id as string, fullName(r as NameRow, fallback)]))
}

export async function listLabReviews(status: LabReviewStatus): Promise<QueueRow[]> {
  const admin = createAdminClient()

  const { data, error } = await orderQueue(
    admin
      .from('lab_reviews')
      .select(
        'id, patient_id, status, summary_status, assigned_to, last_source_at, created_at'
      )
      .eq('status', status)
  )
  if (error) throw new Error(`lab_reviews query failed: ${error.message}`)

  const rows = data ?? []
  if (!rows.length) return []

  const reviewIds = rows.map((r) => r.id as string)
  const patientIds = rows.map((r) => r.patient_id as string)
  const assigneeIds = rows.map((r) => r.assigned_to as string | null).filter(Boolean) as string[]

  const [names, sources, flags] = await Promise.all([
    namesFor([...patientIds, ...assigneeIds]),
    admin.from('lab_review_sources').select('lab_review_id, source').in('lab_review_id', reviewIds),
    listFlagsFor(patientIds),
  ])
  if (sources.error) throw new Error(`lab_review_sources query failed: ${sources.error.message}`)

  const kindsByReview = new Map<string, Set<string>>()
  for (const s of sources.data ?? []) {
    const key = s.lab_review_id as string
    if (!kindsByReview.has(key)) kindsByReview.set(key, new Set())
    kindsByReview.get(key)!.add(s.source as string)
  }

  return rows.map((r) => ({
    id: r.id as string,
    patientId: r.patient_id as string,
    patientName: names.get(r.patient_id as string) ?? 'Unknown patient',
    status: r.status as string,
    summaryStatus: (r.summary_status as string | null) ?? null,
    assignedTo: (r.assigned_to as string | null) ?? null,
    assignedToName: r.assigned_to ? (names.get(r.assigned_to as string) ?? null) : null,
    lastSourceAt: (r.last_source_at as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
    sourceKinds: [...(kindsByReview.get(r.id as string) ?? [])].sort(),
    flags: flags.get(r.patient_id as string) ?? [],
  }))
}

export type QueueSummary = {
  /** Active and needs-attention reviews this provider owns, newest first. */
  mine: QueueRow[]
  /** Active reviews nobody has claimed. */
  unassigned: QueueRow[]
  /** Claimed by somebody else — a count only; another provider's workload is
   *  not this screen's business beyond knowing the queue is being worked. */
  assignedElsewhere: number
  needsAttention: number
}

/**
 * The landing page's view of the queue.
 *
 * Deliberately derived from the same `listLabReviews` the queue page uses
 * rather than its own aggregate query, so the dashboard can never disagree
 * with the list it links to. The queue is small — 55 rows in production — so
 * two full reads cost less than the risk of two orderings drifting apart.
 */
export async function getQueueSummary(viewerId: string): Promise<QueueSummary> {
  const [active, needsAttention] = await Promise.all([
    listLabReviews('active'),
    listLabReviews('needs_attention'),
  ])

  const mineFrom = (rows: QueueRow[]) => rows.filter((r) => r.assignedTo === viewerId)

  return {
    mine: [...mineFrom(needsAttention), ...mineFrom(active)],
    unassigned: active.filter((r) => !r.assignedTo),
    assignedElsewhere: active.filter((r) => r.assignedTo && r.assignedTo !== viewerId).length,
    needsAttention: needsAttention.length,
  }
}

/** Active flag names per patient. `user_flags`/`user_flags_join` have no RLS,
 *  but they are read here through the same client for consistency. */
async function listFlagsFor(patientIds: string[]): Promise<Map<string, string[]>> {
  const unique = [...new Set(patientIds.filter(Boolean))]
  if (!unique.length) return new Map()

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('user_flags_join')
    .select('patient_id, active, user_flags!inner(flag_name, active)')
    .in('patient_id', unique)
    .eq('active', true)
  if (error) throw new Error(`user_flags_join query failed: ${error.message}`)

  const out = new Map<string, string[]>()
  for (const row of data ?? []) {
    const flag = row.user_flags as unknown as { flag_name: string; active: boolean } | null
    if (!flag?.active) continue
    const key = row.patient_id as string
    out.set(key, [...(out.get(key) ?? []), flag.flag_name])
  }
  return out
}

export async function getPatientFlags(patientId: string): Promise<string[]> {
  return (await listFlagsFor([patientId])).get(patientId) ?? []
}

function parseAnalytes(json: unknown): {
  analytes: Analyte[]
  collectionDate: string | null
  sourceFileName: string | null
} {
  const empty = { analytes: [], collectionDate: null, sourceFileName: null }
  if (!json || typeof json !== 'object') return empty

  const results = (json as { labResults?: unknown }).labResults
  if (!Array.isArray(results) || !results.length) return empty

  // One entry per result set the extractor processed, in no reliable order — see
  // `latestCollection`.
  const collections: AnalyteCollection[] = results.map((raw) => {
    const entry = (raw ?? {}) as {
      values?: Record<string, unknown>
      collectionDate?: unknown
      fileName?: unknown
    }

    return {
      collectionDate: typeof entry.collectionDate === 'string' ? entry.collectionDate : null,
      fileName: typeof entry.fileName === 'string' ? entry.fileName : null,
      // jsonb has already lost whatever order the extractor wrote, so reading
      // order has to be restored here — see `analytes.ts`.
      analytes: orderAnalytes(
        Object.entries(entry.values ?? {})
          // Every entry carries all nine panel keys, and a null means the
          // extractor did not find that analyte. Dropping it is correct —
          // rendering it would print the string "null" on a lab screen.
          .filter(([, v]) => typeof v === 'string' && v.trim())
          .map(([name, v]) => ({ name, value: (v as string).trim() }))
      ),
    }
  })

  const latest = latestCollection(collections)

  return {
    analytes: latest?.analytes ?? [],
    collectionDate: latest?.collectionDate ?? null,
    sourceFileName: latest?.fileName ?? null,
  }
}

export async function getLabReview(id: string): Promise<LabReviewDetail | null> {
  const admin = createAdminClient()

  const { data: review, error } = await admin
    .from('lab_reviews')
    .select(
      'id, patient_id, status, summary_status, summary_error, assigned_to, started_at, started_by, draft, draft_updated_at, resolution, reviewed_at, needs_attention_reason, report_id, last_source_at, created_at'
    )
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`lab_reviews lookup failed: ${error.message}`)
  if (!review) return null

  const [{ data: siblings, error: siblingsError }, sourcesResult, reportResult, names] =
    await Promise.all([
      orderQueue(admin.from('lab_reviews').select('id').eq('status', review.status as string)),
      admin
        .from('lab_review_sources')
        .select('id, source, file_path, occurred_at')
        .eq('lab_review_id', id)
        .order('occurred_at', { ascending: false, nullsFirst: false }),
      review.report_id
        ? admin
            .from('lab_review_reports')
            .select('id, patient_name, patient_summary, lab_analysis_results, created_at')
            .eq('id', review.report_id as string)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      namesFor(
        [
          review.patient_id as string,
          review.assigned_to as string,
          review.started_by as string,
        ].filter(Boolean)
      ),
    ])

  if (siblingsError) throw new Error(`queue position query failed: ${siblingsError.message}`)
  if (sourcesResult.error) {
    throw new Error(`lab_review_sources query failed: ${sourcesResult.error.message}`)
  }
  if (reportResult.error) {
    throw new Error(`lab_review_reports query failed: ${reportResult.error.message}`)
  }

  const queue = (siblings ?? []).map((r) => r.id as string)
  const index = queue.indexOf(id)

  const reportRow = reportResult.data as {
    id: string
    patient_name: string | null
    patient_summary: string | null
    lab_analysis_results: unknown
    created_at: string | null
  } | null

  const extracted = reportRow ? parseAnalytes(reportRow.lab_analysis_results) : null

  return {
    id: review.id as string,
    patientId: review.patient_id as string,
    status: review.status as string,
    summaryStatus: (review.summary_status as string | null) ?? null,
    summaryError: (review.summary_error as string | null) ?? null,
    assignedTo: (review.assigned_to as string | null) ?? null,
    assignedToName: review.assigned_to
      ? (names.get(review.assigned_to as string) ?? null)
      : null,
    startedAt: (review.started_at as string | null) ?? null,
    startedByName: review.started_by
      ? (names.get(review.started_by as string) ?? null)
      : null,
    draft: parseDraft(review.draft),
    draftUpdatedAt: (review.draft_updated_at as string | null) ?? null,
    resolution: (review.resolution as string | null) ?? null,
    reviewedAt: (review.reviewed_at as string | null) ?? null,
    needsAttentionReason: (review.needs_attention_reason as string | null) ?? null,
    lastSourceAt: (review.last_source_at as string | null) ?? null,
    createdAt: (review.created_at as string | null) ?? null,
    queuePosition: index >= 0 ? index + 1 : null,
    queueTotal: queue.length,
    report: reportRow
      ? {
          id: reportRow.id,
          patientName: reportRow.patient_name,
          patientSummary: reportRow.patient_summary,
          createdAt: reportRow.created_at,
          analytes: extracted!.analytes,
          collectionDate: extracted!.collectionDate,
          sourceFileName: extracted!.sourceFileName,
        }
      : null,
    sources: (sourcesResult.data ?? []).map((s) => ({
      id: Number(s.id),
      source: s.source as string,
      filePath: (s.file_path as string | null) ?? null,
      occurredAt: (s.occurred_at as string | null) ?? null,
    })),
  }
}

export type PatientHeader = {
  patientId: string
  name: string
  status: string | null
  /** The raw `user_list.status` id behind that label. Carried because two features
   *  branch on it numerically — which dispositions apply, and which consultation
   *  types suit the patient — and re-deriving it from the label would break the
   *  moment somebody edits `user_statuses`. */
  statusId: number | null
  age: number | null
  gender: string | null
  dateOfBirth: string | null
  phone: string | null
  email: string | null
  address: string | null
  /** Carried separately from the formatted address because it decides whether
   *  discounted labs may be offered — New York and New Jersey prohibit them. */
  state: string | null
  flags: string[]
  protocol: string | null
}

function ageFrom(dob: string | null): number | null {
  if (!dob) return null
  const born = new Date(dob)
  if (Number.isNaN(born.getTime())) return null
  const now = new Date()
  let age = now.getUTCFullYear() - born.getUTCFullYear()
  const monthDiff = now.getUTCMonth() - born.getUTCMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < born.getUTCDate())) age -= 1
  return age >= 0 && age < 130 ? age : null
}

function addressOf(row: {
  mailing_address: string | null
  city: string | null
  state: string | null
  zip_code: string | null
}): string | null {
  const tail = [row.city, [row.state, row.zip_code].filter(Boolean).join(' ').trim()]
    .filter(Boolean)
    .join(', ')
  const full = [row.mailing_address, tail].filter(Boolean).join(', ')
  return full || null
}

export async function getPatientHeader(patientId: string): Promise<PatientHeader | null> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('user_list')
    .select(
      'user_id, first_name, last_name, preferred_name, date_of_birth, gender, phone_number, email, mailing_address, city, state, zip_code, status'
    )
    .eq('user_id', patientId)
    .maybeSingle()
  if (error) throw new Error(`user_list lookup failed: ${error.message}`)
  if (!data) return null

  const [statusLabel, flags, protocol] = await Promise.all([
    data.status ? statusLabelFor(Number(data.status)) : Promise.resolve(null),
    getPatientFlags(patientId),
    activeProtocolLabel(patientId),
  ])

  return {
    patientId,
    name: fullName(data as NameRow),
    status: statusLabel,
    statusId: data.status === null || data.status === undefined ? null : Number(data.status),
    age: ageFrom(data.date_of_birth as string | null),
    gender: (data.gender as string | null) ?? null,
    dateOfBirth: (data.date_of_birth as string | null) ?? null,
    phone: (data.phone_number as string | null) ?? null,
    email: (data.email as string | null) ?? null,
    address: addressOf(
      data as {
        mailing_address: string | null
        city: string | null
        state: string | null
        zip_code: string | null
      }
    ),
    state: (data.state as string | null) ?? null,
    flags,
    protocol,
  }
}

async function statusLabelFor(statusId: number): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('user_statuses')
    .select('status')
    .eq('id', statusId)
    .maybeSingle()
  if (error) return null
  return (data?.status as string | null) ?? null
}

/**
 * The design's status pill reads "Active — Weekly Injections". Only the first
 * half is stored; there is no protocol-name field anywhere. This derives the
 * second half from the patient's active medications, and returns null rather
 * than inventing a phrase when there are none.
 */
async function activeProtocolLabel(patientId: string): Promise<string | null> {
  const meds = await getMedications(patientId)
  const active = meds.filter((m) => m.active)
  if (!active.length) return null
  return active
    .slice(0, 2)
    .map((m) => m.name)
    .join(' + ')
}

export type Medication = {
  id: number
  /** `medications_list.id` — the catalog entry, not this patient's row. What the
   *  dosing options are keyed by. */
  medicationId: number
  name: string
  type: string | null
  dosage: string | null
  pharmacy: string | null
  expiration: string | null
  active: boolean
  startedAt: string | null
}

/**
 * `patient_medications.user_id` is the **patient** — unlike `orders`, where
 * `user_id` is the staff member who created the row.
 *
 * `expiration` is text and is sometimes the empty string rather than null, so
 * emptiness has to be tested before parsing. An unparseable or absent
 * expiration is treated as active, matching how the admin UI reads it.
 */
export async function getMedications(patientId: string): Promise<Medication[]> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('patient_medications')
    .select(
      'id, medication_id, created_at, expiration, pharmacy, medications_list(name, type), medication_dosage(value), medication_dosage_personal(value)'
    )
    .eq('user_id', patientId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`patient_medications query failed: ${error.message}`)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (data ?? []).map((row) => {
    const med = row.medications_list as unknown as { name: string; type: string | null } | null
    const dosage = row.medication_dosage as unknown as { value: string | null } | null
    const personal = row.medication_dosage_personal as unknown as { value: string | null } | null

    const expirationRaw = (row.expiration as string | null)?.trim() || null
    const expires = expirationRaw ? new Date(expirationRaw) : null
    const active = !expires || Number.isNaN(expires.getTime()) || expires >= today

    return {
      id: Number(row.id),
      medicationId: Number(row.medication_id),
      name: med?.name ?? 'Unnamed medication',
      type: med?.type ?? null,
      // A personal dosage overrides the catalog dosage when present.
      dosage: personal?.value?.trim() || dosage?.value?.trim() || null,
      pharmacy: (row.pharmacy as string | null)?.trim() || null,
      expiration: expirationRaw,
      active,
      startedAt: (row.created_at as string | null) ?? null,
    }
  })
}

/** One dose a medication is normally prescribed at. */
export type DosageOption = {
  /** `medications_list.id`, which is how these are grouped. */
  medicationId: number
  id: number
  value: string
}

/**
 * Every dosing choice the clinic keeps, from the same `medication_dosage` table
 * the admin app's medication modal reads.
 *
 * These are what a provider should be picking from, because they are the doses
 * the pharmacy is set up to fill. The coverage is uneven and that is the point of
 * returning them rather than assuming them: Anastrozole has eight
 * (`1.00mg - Take 1/2 tablet (0.50mg) by mouth twice weekly…`), the testosterone
 * cream has four written in clicks per day, and `Other` — 560 active rows — has
 * none at all, so the UI has to keep working with an empty list.
 *
 * All 89 rows come down at once, unfiltered, because adding a medication offers
 * the whole catalog and the patient's own prescriptions are no guide to what a
 * provider is about to start.
 */
export async function getDosageOptions(): Promise<DosageOption[]> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('medication_dosage')
    .select('id, medication_id, value')
    // Authored low dose to high, so the ids are the clinical order.
    .order('id', { ascending: true })
  if (error) throw new Error(`medication_dosage query failed: ${error.message}`)

  return (data ?? [])
    .map((row) => ({
      medicationId: Number(row.medication_id),
      id: Number(row.id),
      value: ((row.value as string | null) ?? '').trim(),
    }))
    .filter((option) => option.value.length > 0)
}

/** A medication that can be started, as the picker lists it. */
export type CatalogMedication = {
  /** `medications_list.id` — what `DosageOption.medicationId` refers to. */
  id: number
  name: string
  type: string | null
}

/**
 * The medications a protocol can be added to, in the order a picker should show
 * them.
 *
 * Restricted rows are dropped here rather than in the UI so no caller can offer
 * them by forgetting to filter — see `RESTRICTED_MEDICATION_IDS`. `name` is
 * trimmed because two catalog rows carry a trailing newline.
 */
export async function getMedicationCatalog(): Promise<CatalogMedication[]> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('medications_list')
    .select('id, name, type')
    .order('name', { ascending: true })
  if (error) throw new Error(`medications_list query failed: ${error.message}`)

  return (data ?? [])
    .map((row) => ({
      id: Number(row.id),
      name: ((row.name as string | null) ?? '').trim(),
      type: (row.type as string | null)?.trim() || null,
    }))
    .filter((med) => med.name.length > 0 && !RESTRICTED_MEDICATION_IDS.includes(med.id))
}
