import 'server-only'

import type { ProviderAccess } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Create one Open Action for the customer service group.
 *
 * Extracted from `labReviews/followUpSend.ts` so a Provider Question can ask CS
 * for something the same way a Lab Review does: same `actions` row, same "New"
 * status and "Normal" priority, same group. Linking the action back to the work
 * row is the caller's job, since each work type has its own column for it.
 */
export type CsActionResult =
  | { ok: true; actionId: string }
  | { ok: false; error: string }

export async function createCustomerServiceAction(
  access: ProviderAccess,
  input: { patientId: string; title: string; description: string }
): Promise<CsActionResult> {
  const admin = createAdminClient()

  const [statusRow, priorityRow, csRole] = await Promise.all([
    admin.from('actions_statuses').select('id').eq('name', 'New').maybeSingle(),
    admin.from('actions_priorities').select('id').eq('name', 'Normal').maybeSingle(),
    admin.from('user_roles').select('id').eq('role', 'customer_service').maybeSingle(),
  ])

  const statusId = statusRow.data?.id
  const priorityId = priorityRow.data?.id
  const groupId = csRole.data?.id

  if (!statusId || !priorityId || !groupId) {
    return {
      ok: false,
      error: 'the customer service action could not be created (status, priority or group missing)',
    }
  }

  const { data: action, error: actionError } = await admin
    .from('actions')
    .insert({
      title: input.title,
      description: input.description,
      patient_user_id: input.patientId,
      created_by_user_id: access.userId,
      assignee_group_id: Number(groupId),
      status_id: statusId,
      priority_id: priorityId,
    })
    .select('id')
    .maybeSingle()

  if (actionError || !action) {
    return {
      ok: false,
      error: `the customer service action could not be created (${actionError?.message ?? 'unknown'})`,
    }
  }

  return { ok: true, actionId: action.id as string }
}
