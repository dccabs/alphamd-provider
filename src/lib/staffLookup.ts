import 'server-only'

import { staffDisplayName } from '@/lib/staffName'
import { createAdminClient } from '@/lib/supabase/admin'

/** The chart-note name for a staff account, from `user_list` or the email. */
export async function lookupStaffDisplayName(userId: string, email: string): Promise<string> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('user_list')
    .select('first_name, last_name')
    .eq('user_id', userId)
    .maybeSingle()

  return staffDisplayName(
    { firstName: data?.first_name, lastName: data?.last_name },
    email,
  )
}
