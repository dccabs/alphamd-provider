import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AccessDenied } from '@/components/access-denied'
import { ContentReviewList } from '@/components/content-review-list'
import { PortalChrome } from '@/components/portal-chrome'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { checkContentReviewerAccess } from '@/lib/authz'
import { listContentReviews } from '@/lib/contentReviews/queries'

export const metadata = { title: 'Content Reviews | Alpha MD Provider' }
export const dynamic = 'force-dynamic'

type View = 'queue' | 'changes' | 'approved'

const TABS: { id: View; label: string; blurb: string; empty: string }[] = [
  {
    id: 'queue',
    label: 'Queue',
    blurb: 'Site pages waiting on a medical review, in priority order.',
    empty: 'Nothing waiting. Pages are added by the content review seeding script.',
  },
  {
    id: 'changes',
    label: 'Changes requested',
    blurb: 'Waiting on the AlphaMD editor. Each returns to the queue when a revision is published.',
    empty: 'No pages are waiting on the editor.',
  },
  {
    id: 'approved',
    label: 'Approved',
    blurb: 'Approved as currently published, most recent first.',
    empty: 'No pages are approved as currently published.',
  },
]

/**
 * The Content Review queue: medical review of AlphaMD site pages, one Sanity
 * version at a time. Limited to providers in `content_reviewers`.
 */
export default async function ContentReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const access = await checkContentReviewerAccess()
  if (!access.ok) {
    if (access.reason === 'no-session') redirect('/login?redirect=%2Fcontent-reviews')
    if (access.reason === 'not-allowed-domain') redirect('/login?error=not_authorized')
    if (access.reason === 'not-a-content-reviewer') return <NotAContentReviewer />
    return <AccessDenied />
  }

  const { view: viewParam } = await searchParams
  const view: View = viewParam === 'changes' || viewParam === 'approved' ? viewParam : 'queue'
  const tab = TABS.find((t) => t.id === view)!

  const lists = await listContentReviews()
  const reviews =
    view === 'queue' ? lists.queue : view === 'changes' ? lists.changesRequested : lists.approved
  const counts: Record<View, number> = {
    queue: lists.queue.length,
    changes: lists.changesRequested.length,
    approved: lists.approved.length,
  }
  const mineCount = lists.queue.filter(
    (r) => r.standing === 'in_review' && r.assignedTo === access.access.userId
  ).length

  return (
    <>
      <PortalChrome />
      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Content Reviews</h1>
            <p className="text-sm text-muted-foreground">{tab.blurb}</p>
          </header>

          {!lists.revsChecked && (
            <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Could not reach Sanity, so pages changed since their review are not shown as changed.
              Reload in a moment.
            </p>
          )}

          <nav className="mt-6 flex gap-1 border-b" aria-label="Content review status">
            {TABS.map((t) => {
              const isCurrent = t.id === view
              return (
                <Link
                  key={t.id}
                  href={t.id === 'queue' ? '/content-reviews' : `/content-reviews?view=${t.id}`}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={
                    isCurrent
                      ? 'border-b-2 border-foreground px-3 py-2 text-sm font-medium'
                      : 'border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground'
                  }
                >
                  {t.label}
                  <span className="ml-1.5 tabular-nums text-muted-foreground">{counts[t.id]}</span>
                </Link>
              )
            })}
          </nav>

          {reviews.length === 0 ? (
            <p className="mt-10 text-center text-sm text-muted-foreground">{tab.empty}</p>
          ) : (
            <div className="mt-4">
              <ContentReviewList
                reviews={reviews}
                viewerId={access.access.userId}
                numbered={view === 'queue'}
              />
            </div>
          )}

          {view === 'queue' && mineCount > 0 && (
            <p className="mt-4 text-xs text-muted-foreground">{mineCount} in review with you</p>
          )}
        </div>
      </main>
    </>
  )
}

function NotAContentReviewer() {
  return (
    <>
      <PortalChrome />
      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Content Reviews are for content reviewers</CardTitle>
            <CardDescription>
              Your provider account is not set up to review site content. Ask an administrator to
              add you as a content reviewer.{' '}
              <Link href="/" className="underline underline-offset-4">
                Back to the dashboard
              </Link>
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    </>
  )
}
