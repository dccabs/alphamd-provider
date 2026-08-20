import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

import { PatientStatusPill } from '@/components/patient-status'
import { Badge } from '@/components/ui/badge'
import { progressOf, queueRowMeta, type QueueRow } from '@/lib/labReviews/queueRow'

/**
 * The lab-review queue as a list of rows.
 *
 * Shared by the dashboard and `/lab-reviews` so the two can never describe the
 * same review differently. Each row answers, in order: who is this, how to reach
 * them, what kind of patient are they, is anyone working on it, and how fresh is
 * that work.
 *
 * `numbered` matches the queue page's position column, which lines up with the
 * "Review N of M" pill on the detail screen.
 */
export function QueueList({
  reviews,
  numbered = false,
}: {
  reviews: QueueRow[]
  numbered?: boolean
}) {
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {reviews.map((review, index) => {
        const progress = progressOf(review)

        return (
          <li key={review.id}>
            <Link
              href={`/lab-reviews/${review.id}`}
              className="flex items-start gap-3 px-4 py-3 hover:bg-muted/60"
            >
              {numbered && (
                <span className="w-6 shrink-0 pt-px text-xs tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
              )}

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{review.patientName}</span>
                  <PatientStatusPill status={review.patientStatus} compact />

                  {progress === 'in_progress' && (
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-900">
                      In progress
                    </Badge>
                  )}
                  {review.status === 'needs_attention' && (
                    <Badge variant="destructive">Needs attention</Badge>
                  )}
                  {review.flags.map((flag) => (
                    <Badge key={flag} variant="destructive">
                      {flag}
                    </Badge>
                  ))}
                  {review.summaryStatus && review.summaryStatus !== 'ready' && (
                    <Badge variant="secondary">Summary {review.summaryStatus}</Badge>
                  )}
                </span>

                {review.patientEmail && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {review.patientEmail}
                  </span>
                )}

                <span className="mt-1 block text-xs text-muted-foreground">
                  {queueRowMeta(review).join(' · ')}
                </span>
              </span>

              <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
