'use client'

import { Button } from '@/components/ui/button'
import type { Analyte } from '@/lib/labReviews/analytes'
import { clinicFlag, type ClinicFlag } from '@/lib/labReviews/clinicFlags'

/**
 * The numbers on the document below it.
 *
 * This strip used to hold the AI summary as well, which the AI tab in the right
 * rail already shows — so it is now only the lab: every value the extractor found
 * on the most recent report, in full, in the reading order `orderAnalytes`
 * applies. Nothing is behind a chip, a dialog or a "+N more".
 *
 * Only the latest collection. A report can carry several — a retest arrives as
 * its own collection alongside the panel it followed — and putting an older one
 * on screen next to the current numbers invites reading a stale value as today's.
 *
 * Clinic flags are painted here from the AlphaMD config list, not from a range
 * on the report — see `clinicFlags.ts` and ADR 0004.
 */

const FLAG_SURFACE: Record<ClinicFlag, string> = {
  yellow: 'bg-yellow-100',
  red: 'bg-red-100',
}

export function LabValuesCard({
  analytes,
  collectionDate,
  sourceFileName,
  summaryStatus,
  summaryError,
  offReviewFile,
  shownFileName,
  onBackToReviewFile,
}: {
  analytes: Analyte[]
  collectionDate: string | null
  /** The extractor's own label for the collection, e.g. `Prolactin retest` or
   *  `Combined result for 07/27/26 (2 files: Recent labs, Labs)`. It describes a
   *  result set rather than naming a stored file. */
  sourceFileName: string | null
  summaryStatus: string | null
  summaryError: string | null
  /** The viewer is on some other patient file, so these values are not from the
   *  document currently on screen. */
  offReviewFile: boolean
  shownFileName: string | null
  onBackToReviewFile: () => void
}) {
  const meta = [collectionDate ? `Collected ${collectionDate}` : null, sourceFileName]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="border-b bg-muted/40">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-3">
        <h2 className="text-[13px] font-semibold">Lab values</h2>
        {meta && <span className="min-w-0 truncate text-xs text-muted-foreground">{meta}</span>}
      </div>

      <div className="px-4 pt-2 pb-3">
        {analytes.length ? (
          <>
            <ClinicFlagLegend />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-4">
              {analytes.map((a) => {
                const flag = clinicFlag(a.name, a.value)
                return (
                  <div
                    key={a.name}
                    className={`flex items-baseline justify-between gap-2 border-b px-1.5 py-1 ${flag ? FLAG_SURFACE[flag] : ''}`}
                  >
                    <dt className="truncate text-xs text-muted-foreground">{a.name}</dt>
                    <dd className="shrink-0 text-[13px] font-semibold tabular-nums">{a.value}</dd>
                  </div>
                )
              })}
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              Analytes the extractor did not find are not listed.
            </p>
          </>
        ) : (
          <NoValues summaryStatus={summaryStatus} summaryError={summaryError} />
        )}
      </div>

      {offReviewFile && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-card px-4 py-2">
          <span className="min-w-0 text-xs text-muted-foreground">
            {shownFileName ? (
              <>
                Viewing <span className="font-medium text-foreground">{shownFileName}</span>. These
                values are from the lab under review.
              </>
            ) : (
              'These values are from the lab under review, which is not the document shown.'
            )}
          </span>
          <Button variant="outline" size="sm" onClick={onBackToReviewFile}>
            Back to lab under review
          </Button>
        </div>
      )}
    </div>
  )
}

function ClinicFlagLegend() {
  return (
    <p className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-baseline gap-1.5">
        <span className="inline-block size-2.5 shrink-0 translate-y-px bg-yellow-100 ring-1 ring-yellow-300" />
        Yellow = approaching a clinic threshold.
      </span>
      <span className="inline-flex items-baseline gap-1.5">
        <span className="inline-block size-2.5 shrink-0 translate-y-px bg-red-100 ring-1 ring-red-300" />
        Red = at or past it.
      </span>
      <span>AI-detected — please confirm on the lab document.</span>
    </p>
  )
}

/** Why there are no numbers. Extraction and the summary are the same pipeline, so
 *  its status is what distinguishes "still working" from "found nothing" — and
 *  10% of collections in production genuinely hold no values. */
function NoValues({
  summaryStatus,
  summaryError,
}: {
  summaryStatus: string | null
  summaryError: string | null
}) {
  if (summaryStatus === 'failed') {
    return (
      <p className="text-sm text-destructive">
        This report could not be processed{summaryError ? `: ${summaryError}` : '.'}
      </p>
    )
  }

  if (summaryStatus === 'pending' || summaryStatus === 'processing') {
    return (
      <p className="text-sm text-muted-foreground">
        This report is still being processed. Reload in a moment.
      </p>
    )
  }

  // "this lab" rather than "this report": a report whose newest result set came
  // back empty may still hold values from an older one, which are deliberately
  // not shown here.
  return (
    <p className="text-sm text-muted-foreground">
      No values were extracted from this lab. Read them from the document below.
    </p>
  )
}
