import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { testLabel } from './order.ts'

/**
 * Reads for the lab-ordering panel: who can be named as the ordering provider,
 * and what has already been ordered for this patient.
 *
 * The already-ordered list is not decoration. Without it a provider reviewing
 * labs has no way to see that another provider scheduled a redraw last week, and
 * duplicate orders mean the patient is billed twice and told to visit a lab twice.
 */

export type LabProviderOption = {
  id: string
  name: string
  npi: string | null
}

export async function listLabProviders(): Promise<LabProviderOption[]> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('lab_providers')
    .select('id, name, npi')
    .order('name', { ascending: true })
  if (error) throw new Error(`lab_providers query failed: ${error.message}`)

  return (data ?? [])
    .filter((row) => row.name)
    .map((row) => ({
      id: row.id as string,
      name: row.name as string,
      npi: (row.npi as string | null) ?? null,
    }))
}

export type ScheduledLabOrder = {
  id: string
  createdAt: string | null
  scheduledDate: string | null
  /** `pending` | `sent` | `expired` | `cancelled`. */
  status: string
  testNames: string[]
  /** Set by the main app's cron once the order has actually been issued. */
  processedAt: string | null
}

/**
 * `requests` is jsonb that has been written as an array and as a JSON *string* of
 * an array over the years, so both are read and neither is allowed to throw. A
 * malformed payload costs the test list, not the row.
 */
function requestedNames(raw: unknown): string[] {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter((entry) => entry && typeof entry === 'object' && entry.is_requested)
      .map((entry) => (entry.name as string) || testLabel(entry.code as string))
      .filter(Boolean)
  } catch {
    return []
  }
}

export async function listScheduledLabOrders(patientId: string): Promise<ScheduledLabOrder[]> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('scheduled_lab_requisitions')
    .select('id, created_at, scheduled_date, status, requests, processed_at')
    .eq('patient_id', patientId)
    .order('scheduled_date', { ascending: false })
    .limit(50)
  if (error) throw new Error(`scheduled_lab_requisitions query failed: ${error.message}`)

  return (data ?? []).map((row) => ({
    id: String(row.id),
    createdAt: (row.created_at as string | null) ?? null,
    scheduledDate: (row.scheduled_date as string | null) ?? null,
    status: (row.status as string | null) ?? 'pending',
    testNames: requestedNames(row.requests),
    processedAt: (row.processed_at as string | null) ?? null,
  }))
}
