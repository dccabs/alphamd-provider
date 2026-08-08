import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight } from 'lucide-react'

import { checkProviderAccess } from '@/lib/authz'
import {
  isLabReviewStatus,
  listLabReviews,
  type LabReviewStatus,
} from '@/lib/labReviews/queries'
import { AccessDenied } from '@/components/access-denied'
import { Badge } from '@/components/ui/badge'
import { relativeAge, shortDate } from '@/lib/labReviews/format'

export const metadata = { title: 'Lab reviews | Alpha MD Provider' }

const STATUS_TABS: { id: LabReviewStatus; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'needs_attention', label: 'Needs attention' },
  { id: 'finished', label: 'Finished' },
]

const SOURCE_LABELS: Record<string, string> = {
  incoming_fax: 'Fax',
  patient_upload: 'Upload',
}

const EMPTY_COPY: Record<LabReviewStatus, string> = {
  active: 'Nothing waiting. New labs arrive here from incoming faxes and patient uploads.',
  needs_attention: 'No reviews have been flagged for attention.',
  finished: 'No reviews have been finished yet.',
}

export default async function LabReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const access = await checkProviderAccess()
  if (!access.ok) {
    if (access.reason === 'no-session') redirect('/login?redirect=%2Flab-reviews')
    if (access.reason === 'not-allowed-domain') redirect('/login?error=not_authorized')
    return <AccessDenied />
  }

  const { status: statusParam } = await searchParams
  const status: LabReviewStatus = isLabReviewStatus(statusParam) ? statusParam : 'active'
  const reviews = await listLabReviews(status)

  return (
    <main className="min-h-screen bg-muted">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Lab reviews</h1>
          <p className="text-sm text-muted-foreground">
            Labs waiting on a provider, newest first.
          </p>
        </header>

        <nav className="mt-6 flex gap-1 border-b" aria-label="Review status">
          {STATUS_TABS.map((tab) => {
            const isCurrent = tab.id === status
            return (
              <Link
                key={tab.id}
                href={tab.id === 'active' ? '/lab-reviews' : `/lab-reviews?status=${tab.id}`}
                aria-current={isCurrent ? 'page' : undefined}
                className={
                  isCurrent
                    ? 'border-b-2 border-foreground px-3 py-2 text-sm font-medium'
                    : 'border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground'
                }
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>

        {reviews.length === 0 ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            {EMPTY_COPY[status]}
          </p>
        ) : (
          <ul className="mt-4 divide-y rounded-xl border bg-card">
            {reviews.map((review, index) => (
              <li key={review.id}>
                <Link
                  href={`/lab-reviews/${review.id}`}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-muted/60"
                >
                  <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{review.patientName}</span>
                      {review.flags.map((flag) => (
                        <Badge key={flag} variant="destructive">
                          {flag}
                        </Badge>
                      ))}
                      {review.summaryStatus && review.summaryStatus !== 'ready' && (
                        <Badge variant="secondary">Summary {review.summaryStatus}</Badge>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {[
                        relativeAge(review.lastSourceAt ?? review.createdAt),
                        shortDate(review.lastSourceAt ?? review.createdAt),
                        review.sourceKinds
                          .map((kind) => SOURCE_LABELS[kind] ?? kind)
                          .join(' + '),
                        review.assignedToName
                          ? `Assigned to ${review.assignedToName}`
                          : 'Unassigned',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'} ·{' '}
          {STATUS_TABS.find((t) => t.id === status)?.label.toLowerCase()}
        </p>
      </div>
    </main>
  )
}

export const dynamic = 'force-dynamic'
