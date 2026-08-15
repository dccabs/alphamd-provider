import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight } from 'lucide-react'

import { checkProviderAccess } from '@/lib/authz'
import { getQueueSummary } from '@/lib/labReviews/queries'
import type { QueueRow } from '@/lib/labReviews/queueRow'
import { QueueList } from '@/components/queue-list'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = { title: 'Dashboard | Alpha MD Provider' }
export const dynamic = 'force-dynamic'

/**
 * The provider landing page — where sign-in drops you.
 *
 * The role check is intentionally *softer* here than on `/lab-reviews`. Any
 * `@alphamd.org` account may sign in, and this is the page they land on, so an
 * account without the provider or admin role gets the page with an explanation
 * instead of `<AccessDenied />`. Rendering the denial here would leave such a
 * user with nowhere at all to land after a successful login.
 */
export default async function DashboardPage() {
  const access = await checkProviderAccess()

  if (!access.ok) {
    if (access.reason === 'no-session') redirect('/login')
    if (access.reason === 'not-allowed-domain') redirect('/login?error=not_authorized')
    return <NoQueueAccess />
  }

  const summary = await getQueueSummary(access.access.userId)

  return (
    <main className="min-h-screen bg-muted">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Lab reviews</h1>
            <p className="text-sm text-muted-foreground">{access.access.email}</p>
          </div>
          <Link
            href="/lab-reviews"
            className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4"
          >
            View the full queue
            <ChevronRight className="size-3.5" />
          </Link>
        </header>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Stat
            label="Assigned to me"
            value={summary.mine.length}
            href="/lab-reviews"
            hint={summary.mine.length ? 'Yours to finish' : 'Nothing claimed'}
          />
          <Stat
            label="Unclaimed"
            value={summary.unassigned.length}
            href="/lab-reviews"
            hint={
              summary.assignedElsewhere
                ? `${summary.assignedElsewhere} with another provider`
                : 'Waiting for a provider'
            }
          />
          <Stat
            label="Needs attention"
            value={summary.needsAttention}
            href="/lab-reviews?status=needs_attention"
            hint={summary.needsAttention ? 'Flagged for follow-up' : 'None flagged'}
            urgent={summary.needsAttention > 0}
          />
        </div>

        <Section
          title="Assigned to me"
          empty="Nothing is assigned to you. Start a review from the queue below and it becomes yours."
          reviews={summary.mine}
        />

        <Section
          title="Next in the queue"
          empty="Nothing waiting. New labs arrive here from incoming faxes and patient uploads."
          reviews={summary.unassigned.slice(0, 8)}
          footer={
            summary.unassigned.length > 8
              ? `Showing 8 of ${summary.unassigned.length} unclaimed reviews.`
              : null
          }
        />
      </div>
    </main>
  )
}

function NoQueueAccess() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>You&rsquo;re signed in</CardTitle>
          <CardDescription>
            Your account can sign in to the provider portal, but lab reviews are limited to
            accounts with the provider or admin role.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            If you should have access, ask an administrator to add the provider role to your
            account.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}

function Stat({
  label,
  value,
  hint,
  href,
  urgent,
}: {
  label: string
  value: number
  hint: string
  href: string
  urgent?: boolean
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-xl border bg-card px-5 py-4 hover:bg-muted/60"
    >
      <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      <span
        className={`text-3xl font-semibold tabular-nums ${
          urgent ? 'text-destructive' : ''
        }`}
      >
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </Link>
  )
}

function Section({
  title,
  empty,
  reviews,
  footer,
}: {
  title: string
  empty: string
  reviews: QueueRow[]
  footer?: string | null
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold">{title}</h2>

      {reviews.length === 0 ? (
        <p className="mt-3 rounded-xl border bg-card px-5 py-6 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <div className="mt-3">
          <QueueList reviews={reviews} />
        </div>
      )}

      {footer && <p className="mt-2 text-xs text-muted-foreground">{footer}</p>}
    </section>
  )
}
