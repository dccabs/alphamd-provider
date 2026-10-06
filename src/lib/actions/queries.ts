import 'server-only'

import { contactsFor } from '@/lib/labReviews/queries'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Open Actions assigned to a provider, for the dashboard.
 *
 * `actions` is the admin app's task board. This portal creates rows on it (CS
 * requests from a Lab Review or Provider Question) but has no screen for them,
 * so each row links back to `/admin/actions`.
 *
 * "Open" is any status other than Solved, and not scheduled for later.
 * `status_id` and `priority_id` are resolved through their lookup tables rather
 * than a PostgREST embed, so the read does not depend on how the foreign keys
 * happen to be named.
 */

export type MyAction = {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  /** Tailwind classes the admin app stores per priority, e.g. "bg-red-100 text-red-800". */
  priorityColorClass: string | null
  patientId: string | null
  patientName: string | null
  createdAt: string | null
}

type LookupRow = { id: string; name: string; display_name: string | null; color_class?: string | null }

export async function listMyOpenActions(viewerId: string): Promise<MyAction[]> {
  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  const [actions, statuses, priorities] = await Promise.all([
    admin
      .from('actions')
      .select('id, title, description, status_id, priority_id, patient_user_id, created_at, scheduled_for')
      .eq('assignee_user_id', viewerId)
      .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`)
      .order('created_at', { ascending: false })
      .limit(50),
    admin.from('actions_statuses').select('id, name, display_name'),
    admin.from('actions_priorities').select('id, name, display_name, color_class'),
  ])
  if (actions.error) throw new Error(`actions query failed: ${actions.error.message}`)

  const statusById = new Map((statuses.data ?? []).map((s) => [s.id as string, s as LookupRow]))
  const priorityById = new Map(
    (priorities.data ?? []).map((p) => [p.id as string, p as LookupRow])
  )

  const open = (actions.data ?? []).filter(
    (a) => statusById.get(a.status_id as string)?.name !== 'Solved'
  )
  if (!open.length) return []

  const patientIds = open.map((a) => a.patient_user_id as string | null).filter(Boolean) as string[]
  const contacts = await contactsFor(patientIds)

  return open.map((a) => {
    const status = statusById.get(a.status_id as string)
    const priority = priorityById.get(a.priority_id as string)
    const patientId = (a.patient_user_id as string | null) ?? null
    return {
      id: a.id as string,
      title: (a.title as string) ?? 'Untitled action',
      description: (a.description as string | null) ?? null,
      status: status?.display_name ?? status?.name ?? 'Open',
      priority: priority?.display_name ?? priority?.name ?? 'Normal',
      priorityColorClass: priority?.color_class ?? null,
      patientId,
      patientName: patientId ? (contacts.get(patientId)?.name ?? null) : null,
      createdAt: (a.created_at as string | null) ?? null,
    }
  })
}
