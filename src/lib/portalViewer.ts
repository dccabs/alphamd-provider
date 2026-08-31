import 'server-only'

import { isAllowedProviderEmail } from '@/lib/allowedEmail'
import { lookupStaffDisplayName } from '@/lib/staffLookup'
import { createClient } from '@/lib/supabase/server'

export type PortalViewer = {
  displayName: string
}

/**
 * Who the chrome should name. Softer than `checkProviderAccess`: a signed-in
 * `@alphamd.org` account sees the bar (and can sign out) even when they cannot
 * open a Lab Review.
 */
export async function getPortalViewer(): Promise<PortalViewer | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !isAllowedProviderEmail(user.email)) return null

  return {
    displayName: await lookupStaffDisplayName(user.id, user.email!),
  }
}
