'use server'

import { createClient } from '@/lib/supabase/server'
import { isAllowedProviderEmail } from '@/lib/allowedEmail'

export type ForgotState = { error: string | null; submitted: boolean }

export async function requestPasswordReset(
  _prevState: ForgotState,
  formData: FormData
): Promise<ForgotState> {
  const email = String(formData.get('email') ?? '')

  // Never send a provider-portal reset link to an address outside the allowed
  // domain. Returns the same neutral response so the form cannot be used to
  // enumerate which addresses exist.
  if (!isAllowedProviderEmail(email)) {
    return { error: null, submitted: true }
  }

  const supabase = await createClient()

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/reset-password`,
  })

  if (error) return { error: error.message, submitted: false }
  return { error: null, submitted: true }
}
