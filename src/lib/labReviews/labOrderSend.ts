import 'server-only'

import type { ProviderAccess } from '@/lib/authz'
import { labOrderProblems, scheduleLabOrder } from '@/lib/labOrders/mutations'
import type { LabOrder } from '@/lib/labOrders/order'
import { createAdminClient } from '@/lib/supabase/admin'

export type LabOrderSendResult =
  | { status: 'skipped' }
  | { status: 'placed'; count: number; warning?: string }
  | { status: 'error'; message: string }

/**
 * Place the lab orders on a review, without finishing it.
 *
 * Same placement as close used to do: one `scheduleLabOrder` per draft order,
 * so a requisition from Approve is indistinguishable from one placed at finish.
 */
export async function placeLabReviewOrders(
  access: ProviderAccess,
  reviewId: string,
  orders: LabOrder[]
): Promise<LabOrderSendResult> {
  if (orders.length === 0) return { status: 'skipped' }

  const admin = createAdminClient()
  const { data: review, error: reviewError } = await admin
    .from('lab_reviews')
    .select('patient_id')
    .eq('id', reviewId)
    .maybeSingle()
  if (reviewError) {
    return { status: 'error', message: `Could not load this review: ${reviewError.message}` }
  }
  if (!review) return { status: 'error', message: 'This review no longer exists.' }

  const problems = await labOrderProblems(review.patient_id as string, orders)
  if (problems.length) return { status: 'error', message: problems.join(' ') }

  const warnings: string[] = []
  for (const order of orders) {
    const result = await scheduleLabOrder(access, reviewId, order)
    if (!result.ok) {
      return { status: 'error', message: result.error }
    }
    if (result.warning) warnings.push(result.warning)
  }

  return {
    status: 'placed',
    count: orders.length,
    warning: warnings.length ? warnings.join('; ') : undefined,
  }
}
