import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAllowedProviderEmail } from '@/lib/allowedEmail'

export const metadata = { title: 'Dashboard | Alpha MD Provider' }

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')
  if (!isAllowedProviderEmail(user.email)) redirect('/login?error=not_authorized')

  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-3xl font-semibold text-gray-900">Temporary dashboard</h1>
    </main>
  )
}
