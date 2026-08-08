import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAllowedProviderEmail } from '@/lib/allowedEmail'
import { safeRedirectPath } from '@/lib/safeRedirect'
import LoginForm from './LoginForm'

export const metadata = { title: 'Sign in | Alpha MD Provider' }

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: 'This account does not have access to the provider portal.',
  invalid_link: 'That link is invalid or has expired. Please request a new one.',
  missing_code: 'That link is invalid or has expired. Please request a new one.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string }>
}) {
  const { redirect: redirectParam, error } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user && isAllowedProviderEmail(user.email)) redirect('/')

  const redirectTo = safeRedirectPath(redirectParam)

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
      <h1 className="text-center text-3xl font-extrabold text-gray-900">
        Sign in to your account
      </h1>
      <LoginForm
        redirectTo={redirectTo}
        initialError={(error && ERROR_MESSAGES[error]) || null}
      />
    </main>
  )
}
