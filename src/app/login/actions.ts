'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAllowedProviderEmail } from '@/lib/allowedEmail'
import { safeRedirectPath } from '@/lib/safeRedirect'

export type LoginState = { error: string | null }

export async function login(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const raw = formData.get('redirect')
  const redirectTo = safeRedirectPath(typeof raw === 'string' ? raw : null)

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error || !data.user) {
    return { error: error?.message ?? 'Unable to sign in.' }
  }

  // Gate on the session's authoritative email, not the submitted one.
  if (!isAllowedProviderEmail(data.user.email)) {
    await supabase.auth.signOut()
    return {
      error: 'This account does not have access to the provider portal.',
    }
  }

  redirect(redirectTo)
}
