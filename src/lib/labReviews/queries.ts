import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

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

export type LabReviewReport = {
  id: string
  patientName: string | null
  patientSummary: string | null
  createdAt: string | null
  analytes: Analyte[]
  collectionDate: string | null
  sourceFileName: string | null
}

/** One extracted lab value. There is deliberately no high/low flag: the stored
 *  JSON has display strings only, and no reference-range table exists anywhere
 *  in the database — see the AI chips note in the README. */
export type Analyte = { name: string; value: string }

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

async function namesFor(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))]
  if (!unique.length) return new Map()

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('user_list')
    .select('user_id, first_name, last_name')
    .in('user_id', unique)
  if (error) throw new Error(`user_list lookup failed: ${error.message}`)

  return new Map((data ?? []).map((r) => [r.user_id as string, fullName(r as NameRow)]))
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

  // The extractor emits one entry per lab file; the most recent is first.
  const latest = results[0] as {
    values?: Record<string, unknown>
    collectionDate?: unknown
    fileName?: unknown
  }

  const values = latest?.values ?? {}
  const analytes: Analyte[] = Object.entries(values)
    // A null value means the extractor did not find that analyte. Dropping it
    // is correct — rendering it would print the string "null" on a lab screen.
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([name, v]) => ({ name, value: (v as string).trim() }))

  return {
    analytes,
    collectionDate: typeof latest?.collectionDate === 'string' ? latest.collectionDate : null,
    sourceFileName: typeof latest?.fileName === 'string' ? latest.fileName : null,
  }
}

export async function getLabReview(id: string): Promise<LabReviewDetail | null> {
  const admin = createAdminClient()

  const { data: review, error } = await admin
    .from('lab_reviews')
    .select(
      'id, patient_id, status, summary_status, summary_error, assigned_to, resolution, reviewed_at, needs_attention_reason, report_id, last_source_at, created_at'
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
      namesFor([review.patient_id as string, review.assigned_to as string].filter(Boolean)),
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
  age: number | null
  gender: string | null
  dateOfBirth: string | null
  phone: string | null
  email: string | null
  address: string | null
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
      'id, created_at, expiration, pharmacy, medications_list(name, type), medication_dosage(value), medication_dosage_personal(value)'
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
