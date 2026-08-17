'use client'

import { CheckIcon, MinusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { ReviewStepId } from '@/lib/labReviews/reviewSteps'

/**
 * One step of the review, in one of three states.
 *
 * The flyout used to show every section at once, which made it possible to write
 * a careful assessment and never notice that nothing had been said to the patient.
 * Here the provider is asked one thing at a time and has to either record
 * something or say it is not needed — and saying it is not needed is a click, not
 * an omission, so the reason a step is empty is on the record.
 *
 * Settled steps collapse to a summary row rather than disappearing. By the time
 * the last one is dealt with, the flyout is a list of what the review decided,
 * which is the thing to read before finalizing.
 */

type Props = {
  /** Handed back to `onOpen` and `onAdvance`, so the flyout can pass one handler
   *  for all seven steps instead of building a closure per step. */
  step: ReviewStepId
  title: string
  /** `hidden` for a step not reached yet: it renders nothing at all, so the
   *  flyout only ever shows what has been decided plus the one open question. */
  state: 'hidden' | 'open' | 'settled'
  /** What the collapsed row says. Empty means the step was skipped, and
   *  `skippedLabel` is shown instead. */
  summary: string
  /** How a skipped step reads — "No labs to order", not "Skipped". */
  skippedLabel: string
  /** Whether anything is recorded, which decides whether the step can be skipped
   *  or only continued past. */
  filled: boolean
  /** Reopening a settled step. Collapses whichever step was open. */
  onOpen: (step: ReviewStepId) => void
  onAdvance: (step: ReviewStepId) => void
  /** True when this is the last step, so the button says so rather than promising
   *  a step that does not exist. */
  last: boolean
  /** Rendered on the heading row while the step is open — the "Use AI" button on
   *  the three written boxes. Kept next to the heading rather than above the field,
   *  which is where it was before the sections became steps. */
  action?: React.ReactNode
  children: React.ReactNode
}

export function ReviewStep({
  step,
  title,
  state,
  summary,
  skippedLabel,
  filled,
  onOpen,
  onAdvance,
  last,
  action,
  children,
}: Props) {
  if (state === 'hidden') return null

  if (state === 'settled') {
    return (
      <button
        type="button"
        onClick={() => onOpen(step)}
        className="group flex w-full items-start gap-2.5 rounded-lg border bg-card px-3 py-2 text-left hover:border-foreground/25 hover:bg-muted/50"
      >
        {/* Recorded and skipped are different outcomes and read as different
            rows: a tick means something is going out, a dash means a decision
            was made not to. */}
        {filled ? (
          <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-green-600" />
        ) : (
          <MinusIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-bold tracking-wider text-muted-foreground">
            {title.toUpperCase()}
          </span>
          <span
            className={`mt-0.5 block truncate text-[13px] ${
              filled ? 'font-medium' : 'text-muted-foreground'
            }`}
          >
            {summary || skippedLabel}
          </span>
        </span>
        <span className="mt-0.5 shrink-0 text-xs text-muted-foreground opacity-0 group-hover:opacity-100">
          Edit
        </span>
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-foreground/15 bg-card p-3 shadow-sm">
      {/* The step owns the heading, which is why the panels inside no longer carry
          one of their own. */}
      <div className="flex min-h-6 items-center justify-between gap-2">
        <span className="text-xs font-bold tracking-wider text-muted-foreground">
          {title.toUpperCase()}
        </span>
        {action}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
      {/* One button, whose meaning follows the step. Nothing recorded means the
          only way past is to say so, and the wording says which of the two
          happened rather than leaving "Next" to cover both. */}
      <div className="flex items-center justify-end gap-2 border-t pt-2.5">
        <Button
          variant={filled ? 'default' : 'outline'}
          size="sm"
          onClick={() => onAdvance(step)}
        >
          {filled
            ? last
              ? 'Done'
              : 'Continue'
            : last
              ? 'Skip this step'
              : 'Skip to next step'}
        </Button>
      </div>
    </div>
  )
}
