import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedProviderEmail } from '@/lib/allowedEmail'

/** `user_roles.id` values. Verified against production: 1 admin, 2 employee,
 *  3 provider, 4 signer, 5 customer_service, 6 admin_readonly. */
export const ROLE = {
  admin: 1,
  employee: 2,
  provider: 3,
  signer: 4,
  customerService: 5,
  adminReadonly: 6,
} as const

/** Roles allowed to read a lab review, which is another patient's PHI. */
const LAB_REVIEW_ROLES: number[] = [ROLE.admin, ROLE.provider]

export type ProviderAccess = {
  userId: string
  email: string
  roles: number[]
}

export type AccessResult =
  | { ok: true; access: ProviderAccess }
  | { ok: false; reason: 'no-session' | 'not-allowed-domain' | 'not-a-provider' }

/**
 * Resolve the signed-in user's roles from **`user_roles_join`**, never from
 * `user_list.role`.
 *
 * `user_list.role` is a single-value legacy column with zero `'provider'` rows
 * in production, which is exactly why alphamd's own `requireStaff()` 403s every
 * real provider. `brandons@alphamd.org` holds the provider role in
 * `user_roles_join` while their `user_list.role` is `''`; they are the
 * regression test for this function.
 */
export async function checkProviderAccess(): Promise<AccessResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { ok: false, reason: 'no-session' }
  if (!isAllowedProviderEmail(user.email)) {
    return { ok: false, reason: 'not-allowed-domain' }
  }

  // Read through the service role: user_roles_join's only `authenticated`
  // SELECT policy is is_admin_or_employee(), so a pure provider cannot read
  // their own role rows with the anon key.
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('user_roles_join')
    .select('role')
    .eq('user_id', user.id)

  if (error) throw new Error(`Could not resolve roles: ${error.message}`)

  const roles = (data ?? []).map((r) => Number(r.role))
  if (!roles.some((r) => LAB_REVIEW_ROLES.includes(r))) {
    return { ok: false, reason: 'not-a-provider' }
  }

  return {
    ok: true,
    access: { userId: user.id, email: user.email!, roles },
  }
}

/** Throwing form, for server actions where a denial is a programming error. */
export async function requireProviderAccess(): Promise<ProviderAccess> {
  const result = await checkProviderAccess()
  if (!result.ok) {
    throw new Error(`Lab review access denied: ${result.reason}`)
  }
  return result.access
}
