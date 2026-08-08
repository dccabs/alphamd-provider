import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { AuthShell } from '@/components/auth-shell'
import ResetPasswordForm from './ResetPasswordForm'

export const metadata = { title: 'Reset password | Alpha MD Provider' }

export default async function ResetPasswordPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <AuthShell title="Link expired">
        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            This password reset link is invalid or has expired.
          </p>
          <Link
            href="/forgot-password"
            className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Request a new link
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Set a new password"
      description="Choose a password with at least 8 characters."
    >
      <ResetPasswordForm />
    </AuthShell>
  )
}
