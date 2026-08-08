import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import ResetPasswordForm from './ResetPasswordForm'

export const metadata = { title: 'Reset password | Alpha MD Provider' }

export default async function ResetPasswordPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <main className="mx-auto mt-36 max-w-md px-4 text-center">
        <p>This password reset link is invalid or has expired.</p>
        <Link href="/forgot-password" className="font-medium text-cyan-700">
          Request a new link
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto mt-16 w-full max-w-md px-4">
      <h1 className="text-center text-3xl font-extrabold text-gray-900">
        Reset Password
      </h1>
      <div className="mt-8 rounded-lg bg-white px-4 py-8 shadow sm:px-10">
        <ResetPasswordForm />
      </div>
    </main>
  )
}
