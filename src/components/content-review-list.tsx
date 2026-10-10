'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'

import { takeContentReviewAction } from '@/app/(portal)/content-reviews/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ContentReviewRow } from '@/lib/contentReviews/queries'
import { STANDING_LABEL, reviewRowMeta } from '@/lib/contentReviews/queueRow'
import { isInQueue, type ReviewStanding } from '@/lib/contentReviews/standing'

/**
 * The Content Review queue as a list of rows, shared by the dashboard and
 * `/content-reviews`. Take lives on the row, as on the Provider Question pile.
 */
export function ContentReviewList({
  reviews,
  viewerId,
  numbered = false,
}: {
  reviews: ContentReviewRow[]
  viewerId: string
  numbered?: boolean
}) {
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {reviews.map((review, index) => (
        <ContentReviewRowItem
          key={review.id}
          review={review}
          viewerId={viewerId}
          position={numbered ? index + 1 : null}
        />
      ))}
    </ul>
  )
}

const STANDING_CLASS: Partial<Record<ReviewStanding, string>> = {
  stale: 'border-amber-200 bg-amber-50 text-amber-900',
  revised: 'border-amber-200 bg-amber-50 text-amber-900',
  changes_requested: 'border-gray-200 bg-gray-50 text-gray-700',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-900',
}

function ContentReviewRowItem({
  review,
  viewerId,
  position,
}: {
  review: ContentReviewRow
  viewerId: string
  position: number | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  const mine = review.standing === 'in_review' && review.assignedTo === viewerId
  const takeable = isInQueue(review.standing) && !mine

  const take = () =>
    startTransition(async () => {
      setMessage(null)
      const result = await takeContentReviewAction(review.id)
      if (result.status === 'error') return setMessage(result.message)
      if (result.warning) setMessage(result.warning)
      router.push(`/content-reviews/${result.reviewId}`)
    })

  const badgeLabel = mine ? 'Mine' : STANDING_LABEL[review.standing]
  const badgeClass = mine
    ? 'border-sky-200 bg-sky-50 text-sky-900'
    : (STANDING_CLASS[review.standing] ?? 'border-gray-200 bg-gray-50 text-gray-700')

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      {position !== null && (
        <span className="w-6 shrink-0 pt-px text-xs tabular-nums text-muted-foreground">
          {position}
        </span>
      )}

      <Link
        href={`/content-reviews/${review.id}`}
        className="min-w-0 flex-1 rounded-md -m-1 p-1 hover:bg-muted/60"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{review.title}</span>
          {review.standing !== 'queued' && (
            <Badge variant="outline" className={badgeClass}>
              {badgeLabel}
            </Badge>
          )}
          {review.flags.length > 0 && (
            <Badge variant="destructive">
              {review.flags.length} {review.flags.length === 1 ? 'flag' : 'flags'}
            </Badge>
          )}
        </span>

        <span className="mt-1 block text-xs text-muted-foreground">
          {reviewRowMeta(review).join(' · ')}
        </span>

        {review.standing === 'changes_requested' && review.reviewerComments && (
          <span className="mt-1 block text-xs text-foreground/80 line-clamp-2">
            {review.reviewerComments}
          </span>
        )}

        {message && <span className="mt-1 block text-xs text-destructive">{message}</span>}
      </Link>

      {takeable ? (
        <Button
          size="sm"
          variant={review.standing === 'in_review' ? 'outline' : 'default'}
          disabled={pending}
          onClick={take}
          className="shrink-0"
          title={
            review.standing === 'in_review'
              ? `Take this review from ${review.assignedToName ?? 'its current reviewer'}`
              : 'Take this review'
          }
        >
          {review.standing === 'in_review' ? 'Take over' : 'Take'}
        </Button>
      ) : (
        <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
    </li>
  )
}
