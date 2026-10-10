import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft, ExternalLink } from 'lucide-react'

import { AccessDenied } from '@/components/access-denied'
import { PortalChrome } from '@/components/portal-chrome'
import { SanityRichText } from '@/components/sanity-rich-text'
import { Badge } from '@/components/ui/badge'
import { checkContentReviewerAccess } from '@/lib/authz'
import { listContentReviewEvents } from '@/lib/contentReviews/events'
import { getContentReview, loadReview } from '@/lib/contentReviews/queries'
import { STANDING_LABEL } from '@/lib/contentReviews/queueRow'
import { fetchReviewDocument } from '@/lib/contentReviews/sanity'
import { DOCUMENT_TYPE_LABEL, publicSiteUrl, reviewView, type ReviewView } from '@/lib/contentReviews/view'
import { shortDate, shortDateTime } from '@/lib/labReviews/format'

import { ReviewPanel } from './ReviewPanel'

export const metadata = { title: 'Content Review | Alpha MD Provider' }
export const dynamic = 'force-dynamic'

/**
 * One Content Review: the page as published now, its batch flags, and the
 * decision. The `_rev` rendered here travels with the decision, so an approval
 * is always of the words on this screen.
 */
export default async function ContentReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const access = await checkContentReviewerAccess()
  if (!access.ok) {
    if (access.reason === 'no-session') {
      redirect(`/login?redirect=${encodeURIComponent(`/content-reviews/${id}`)}`)
    }
    if (access.reason === 'not-allowed-domain') redirect('/login?error=not_authorized')
    if (access.reason === 'not-a-content-reviewer') redirect('/content-reviews')
    return <AccessDenied />
  }

  const row = await loadReview(id)
  if (!row) notFound()

  let view: ReviewView | null = null
  let currentRev: string | null | undefined
  try {
    const doc = await fetchReviewDocument(row.sanity_document_id)
    view = doc ? reviewView(doc) : null
    currentRev = doc ? doc._rev : null
  } catch {
    currentRev = undefined
  }

  const detail = await getContentReview(row, currentRev)
  if (!detail) notFound()
  const { review, history, isLatest } = detail
  const events = await listContentReviewEvents(history.map((h) => h.id))
  const earlier = history.filter((h) => h.id !== review.id && h.reviewedAt)

  return (
    <>
      <PortalChrome />
      <main className="flex-1">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <article className="min-w-0">
            <Link
              href="/content-reviews"
              className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-4" /> Content Reviews
            </Link>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{DOCUMENT_TYPE_LABEL[review.documentType]}</span>
              <Badge variant="outline">{STANDING_LABEL[review.standing]}</Badge>
              {view && (
                <a
                  href={publicSiteUrl(view.publicPath)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  Open live page <ExternalLink className="size-3" />
                </a>
              )}
            </div>

            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{view?.title || review.title}</h1>
            {view?.subtitle && <p className="mt-1 text-muted-foreground">{view.subtitle}</p>}

            {view ? (
              <>
                <dl className="mt-4 grid gap-1 rounded-lg border bg-card p-4 text-sm">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Meta description
                  </dt>
                  <dd>{view.metaDescription || '—'}</dd>
                  {view.byline && (
                    <>
                      <dt className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Author
                      </dt>
                      <dd>{view.byline}</dd>
                    </>
                  )}
                </dl>

                <div className="mt-6 rounded-lg border bg-card p-6 text-[15px] leading-relaxed">
                  {view.sections.map((section, i) => (
                    <section key={i} className={i > 0 ? 'mt-8' : undefined}>
                      {section.heading && (
                        <h2 className="mb-3 text-lg font-semibold">{section.heading}</h2>
                      )}
                      {section.items && (
                        <ul className="list-disc pl-6">
                          {section.items.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      )}
                      {section.blocks && <SanityRichText blocks={section.blocks} />}
                    </section>
                  ))}
                </div>

                <p className="mt-2 text-xs text-muted-foreground">
                  Sanity revision <code>{view.rev}</code>
                  {view.updatedAt ? ` · published ${shortDateTime(view.updatedAt)} UTC` : null}
                </p>
              </>
            ) : (
              <p className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {currentRev === undefined
                  ? 'Could not load this page from Sanity. Reload in a moment.'
                  : 'This page is not published in Sanity, so there is nothing to review.'}
              </p>
            )}
          </article>

          <aside className="flex flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
            <ReviewPanel
              reviewId={review.id}
              standing={review.standing}
              assignedTo={review.assignedTo}
              assignedToName={review.assignedToName}
              viewerId={access.access.userId}
              shownRev={view?.rev ?? null}
              latestReviewId={isLatest ? null : (history[0]?.id ?? null)}
              reviewedByName={review.reviewedByName}
              reviewedAt={review.reviewedAt}
              reviewerComments={review.reviewerComments}
            />

            {review.flags.length > 0 && (
              <section className="rounded-lg border bg-card p-4">
                <h2 className="text-sm font-semibold">Batch flags</h2>
                <ul className="mt-2 flex flex-col gap-3 text-sm">
                  {review.flags.map((flag, i) => (
                    <li key={i}>
                      <span className="font-medium">{flag.label}</span>
                      {flag.severity && (
                        <span className="ml-1.5 text-xs text-muted-foreground">({flag.severity})</span>
                      )}
                      {flag.detail && <p className="mt-0.5 text-foreground/80">{flag.detail}</p>}
                      {flag.url && (
                        <a
                          href={flag.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-0.5 block truncate text-xs text-blue-600 underline"
                        >
                          {flag.url}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {earlier.length > 0 && (
              <section className="rounded-lg border bg-card p-4">
                <h2 className="text-sm font-semibold">Earlier reviews</h2>
                <ul className="mt-2 flex flex-col gap-3 text-sm">
                  {earlier.map((h) => (
                    <li key={h.id}>
                      <Link href={`/content-reviews/${h.id}`} className="font-medium hover:underline">
                        {h.status === 'approved' ? 'Approved' : 'Changes requested'}
                      </Link>{' '}
                      <span className="text-xs text-muted-foreground">
                        {[h.reviewedByName, shortDate(h.reviewedAt)].filter(Boolean).join(' · ')}
                      </span>
                      {h.reviewerComments && (
                        <p className="mt-0.5 whitespace-pre-wrap text-foreground/80">{h.reviewerComments}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {events.length > 0 && (
              <section className="rounded-lg border bg-card p-4">
                <h2 className="text-sm font-semibold">History</h2>
                <ul className="mt-2 flex flex-col gap-2 text-xs">
                  {events.map((e) => (
                    <li key={e.id}>
                      <span className="text-muted-foreground">{shortDateTime(e.createdAt)}</span>{' '}
                      {e.summary}
                      {e.rev && <code className="ml-1 text-muted-foreground">{e.rev}</code>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      </main>
    </>
  )
}
