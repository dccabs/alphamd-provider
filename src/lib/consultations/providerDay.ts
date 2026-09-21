import 'server-only'

import { contactsFor, listPatientStatuses } from '@/lib/labReviews/queries'
import { consultationOutcome, type ConsultationOutcome } from '@/lib/labReviews/consultations'
import { createAdminClient } from '@/lib/supabase/admin'
import { dayWindow } from './day'

/**
 * A provider's own consultations, for the dashboard's day view.
 *
 * `user_consultation_schedules.medical_provider` is the staff member on the
 * call and `user_id` is the patient — the reverse of what the column names
 * suggest, see `labReviews/tabs.ts`. The Join URL is buried in Calendly's
 * `metadata.location.join_url`.
 *
 * The rows come back for a window around the requested day, not the day
 * itself; which of them are "today" is the browser's call (`day.ts`).
 */

export type ProviderConsultation = {
  id: string
  startsAt: string
  endsAt: string | null
  /** e.g. "AlphaMD Provider, Secondary Follow-Up". */
  name: string | null
  patientId: string
  patientName: string
  patientEmail: string | null
  patientStatus: string | null
  joinUrl: string | null
  outcome: ConsultationOutcome
}

function joinUrlOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  const m = metadata as { location?: { join_url?: unknown }; join_url?: unknown }
  const candidate = m.location?.join_url ?? m.join_url
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null
}

export async function listProviderConsultations(
  viewerId: string,
  dayKey: string | null
): Promise<ProviderConsultation[]> {
  const admin = createAdminClient()
  const { from, to } = dayWindow(dayKey)

  const { data, error } = await admin
    .from('user_consultation_schedules')
    .select('id, event_start_time, event_end_time, event_status, event_name, user_id, metadata')
    .eq('medical_provider', viewerId)
    .gte('event_start_time', from)
    .lt('event_start_time', to)
    .order('event_start_time', { ascending: true })
  if (error) throw new Error(`user_consultation_schedules query failed: ${error.message}`)

  const rows = (data ?? []).filter((r) => typeof r.event_start_time === 'string')
  if (!rows.length) return []

  const patientIds = rows.map((r) => r.user_id as string).filter(Boolean)
  const [contacts, statuses] = await Promise.all([
    contactsFor(patientIds),
    listPatientStatuses(patientIds),
  ])

  return rows.map((r) => {
    const patientId = (r.user_id as string) ?? ''
    return {
      id: String(r.id),
      startsAt: r.event_start_time as string,
      endsAt: (r.event_end_time as string | null) ?? null,
      name: (r.event_name as string | null) ?? null,
      patientId,
      patientName: contacts.get(patientId)?.name ?? 'Unknown patient',
      patientEmail: contacts.get(patientId)?.email ?? null,
      patientStatus: statuses.get(patientId) ?? null,
      joinUrl: joinUrlOf(r.metadata),
      outcome: consultationOutcome(r.event_status as string | null, r.event_start_time as string),
    }
  })
}