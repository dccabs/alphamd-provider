'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { shortDate } from '@/lib/labReviews/format'
import { isInQueue, type ReviewStanding } from '@/lib/contentReviews/standing'

import { decideContentReviewAction, takeContentReviewAction } from '../actions'

/**
 * Take, then Approve or Request changes. The decision carries `shownRev`, the
 * Sanity `_rev` the page beside this panel rendered.
 */
export function ReviewPanel({
  reviewId,
  standing,
  assignedTo,
  assignedToName,
  viewerId,
  shownRev,
  latestReviewId,
  reviewedByName,
  reviewedAt,
  reviewerComments,
}: {
  reviewId: string
  standing: ReviewStanding
  assignedTo: string | null
  assignedToName: string | null
  viewerId: string
  shownRev: string | null
  /** Set when this is an earlier review: the document's current one. */
  latestReviewId: string | null
  reviewedByName: string | null
  reviewedAt: string | null
  reviewerComments: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [comment, setComment] = useState('')
  const [message, setMessage] = useState<{ tone: 'error' | 'warning'; text: string } | null>(null)

  const mine = standing === 'in_review' && assignedTo === viewerId

  const run = (action: () => ReturnType<typeof takeContentReviewAction>) =>
    startTransition(async () => {
      setMessage(null)
      const result = await action()
      if (result.status === 'error') {
        setMessage({ tone: 'error', text: result.message })
        return
      }
      if (result.warning) setMessage({ tone: 'warning', text: result.warning })
      if (result.reviewId !== reviewId) router.push(`/content-reviews/${result.reviewId}`)
      else router.refresh()
    })

  const decided = reviewedAt && (
    <p className="text-sm text-muted-foreground">
      {standing === 'approved' || standing === 'stale' ? 'Approved' : 'Changes requested'}
      {reviewedByName ? ` by ${reviewedByName}` : ''} on {shortDate(reviewedAt)}.
    </p>
  )

  let body: React.ReactNode
  if (latestReviewId) {
    body = (
      <>
        {decided}
        <p className="text-sm">
          This is an earlier review of the page.{' '}
          <Link href={`/content-reviews/${latestReviewId}`} className="underline underline-offset-4">
            Open the current review
          </Link>
        </p>
      </>
    )
  } else if (mine) {
    body = shownRev ? (
      <>
        <label htmlFor="review-comment" className="text-sm font-medium">
          Comments for the editor
        </label>
        <Textarea
          id="review-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={6}
          placeholder="Required to request changes. Say what is wrong and what it should say."
          disabled={pending}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending}
            onClick={() => run(() => decideContentReviewAction(reviewId, 'approve', shownRev, comment))}
          >
            Approve
          </Button>
          <Button
            variant="outline"
            disabled={pending || !comment.trim()}
            onClick={() =>
              run(() => decideContentReviewAction(reviewId, 'request_changes', shownRev, comment))
            }
          >
            Request changes
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Approving records you, the time, and Sanity revision <code>{shownRev}</code>. Any later
          publish of the page makes the approval stale.
        </p>
      </>
    ) : (
      <p className="text-sm text-muted-foreground">The page could not be loaded, so it cannot be decided.</p>
    )
  } else if (isInQueue(standing)) {
    body = (
      <>
        {standing === 'stale' && decided}
        {standing === 'stale' && (
          <p className="text-sm">The page was published again after approval. Review the current version.</p>
        )}
        {standing === 'revised' && decided}
        {standing === 'revised' && (
          <p className="text-sm">The editor published a revision after changes were requested.</p>
        )}
        {standing === 'in_review' && (
          <p className="text-sm text-muted-foreground">{assignedToName ?? 'Another reviewer'} has this review.</p>
        )}
        <Button disabled={pending} onClick={() => run(() => takeContentReviewAction(reviewId))}>
          {standing === 'in_review' ? 'Take over' : 'Take'}
        </Button>
      </>
    )
  } else if (standing === 'changes_requested') {
    body = (
      <>
        {decided}
        {reviewerComments && <p className="whitespace-pre-wrap text-sm">{reviewerComments}</p>}
        <p className="text-xs text-muted-foreground">
          Waiting on the AlphaMD editor. It returns to the queue when a revision is published.
        </p>
      </>
    )
  } else {
    body = (
      <>
        {decided}
        {reviewerComments && <p className="whitespace-pre-wrap text-sm">{reviewerComments}</p>}
        <p className="text-xs text-muted-foreground">Approved as currently published.</p>
      </>
    )
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">Review</h2>
      {body}
      {message && (
        <p className={message.tone === 'error' ? 'text-sm text-destructive' : 'text-sm text-amber-700'}>
          {message.text}
        </p>
      )}
    </section>
  )
}
