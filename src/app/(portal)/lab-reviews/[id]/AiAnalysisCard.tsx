'use client'

import { useState } from 'react'
import { ChevronDown, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SummaryBlocks } from '@/components/summary-blocks'
import type { Block } from '@/lib/labReviews/summaryMarkdown'

export type Analyte = { name: string; value: string }
export type AnalyteCollection = {
  collectionDate: string | null
  fileName: string | null
  analytes: Analyte[]
}

/** Short labels for the chips, so they fit the header row the way the design
 *  does. Anything not listed falls back to its full analyte name. */
const CHIP_LABELS: Record<string, string> = {
  'Total Testosterone': 'Total T',
  'Free Testosterone': 'Free T',
  Estradiol: 'E2',
  Hematocrit: 'Hct',
  Hemoglobin: 'Hgb',
  Prolactin: 'PRL',
}

export function AiAnalysisCard({
  blocks,
  analytes,
  collections,
  collectionDate,
  summaryStatus,
  summaryError,
}: {
  blocks: Block[]
  analytes: Analyte[]
  collections: AnalyteCollection[]
  collectionDate: string | null
  summaryStatus: string | null
  summaryError: string | null
}) {
  const [open, setOpen] = useState(false)
  const [showAllValues, setShowAllValues] = useState(false)

  const failed = summaryStatus === 'failed'
  const pending = summaryStatus === 'pending' || summaryStatus === 'processing'

  return (
    <div className="border-b bg-muted/40">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-violet-600" />
          <span className="text-[13px] font-semibold">AI Lab Analysis</span>
          <Badge variant="secondary">AI</Badge>
          {collectionDate && (
            <span className="text-xs text-muted-foreground">Collected {collectionDate}</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/*
            No up/down arrows and no colour-coding by severity. The stored JSON
            has display strings only — no reference interval and no H/L flag —
            and there is no reference-range table anywhere in the database, so
            any arrow here would be a clinical threshold invented in front-end
            code. See README, "Not yet wired to real data".
          */}
          {analytes.slice(0, 4).map((a) => (
            <span
              key={a.name}
              title={a.name}
              className="rounded-md border bg-card px-2 py-1 text-xs font-medium"
            >
              {CHIP_LABELS[a.name] ?? a.name} {a.value}
            </span>
          ))}
          {analytes.length > 4 && (
            <button
              type="button"
              onClick={() => setShowAllValues(true)}
              className="rounded text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              +{analytes.length - 4} more
            </button>
          )}
          <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide analysis' : 'Full analysis'}
            <ChevronDown className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </Button>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4">
          {failed ? (
            <p className="text-sm text-destructive">
              The summary could not be generated{summaryError ? `: ${summaryError}` : '.'}
            </p>
          ) : pending ? (
            <p className="text-sm text-muted-foreground">
              The summary is still being generated. Reload in a moment.
            </p>
          ) : (
            <>
              <SummaryBlocks blocks={blocks} />
              <p className="mt-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs text-violet-900">
                Provider judgment required — this summary is generated from the
                chart and labs and is not a medical decision.
              </p>
            </>
          )}
        </div>
      )}

      {showAllValues && (
        <AllValuesDialog collections={collections} onClose={() => setShowAllValues(false)} />
      )}
    </div>
  )
}

/** Every value the extractor recorded, which the four header chips can only
 *  hint at. Almost every report holds a single collection, so the date heading
 *  is suppressed unless there is more than one to tell apart. */
function AllValuesDialog({
  collections,
  onClose,
}: {
  collections: AnalyteCollection[]
  onClose: () => void
}) {
  const multiple = collections.length > 1

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[80dvh] w-full gap-0 overflow-y-auto p-0 sm:max-w-md">
        <DialogHeader className="px-5 pt-5 pb-4">
          <DialogTitle>Recorded lab values</DialogTitle>
          <DialogDescription>
            Extracted from the uploaded lab {collections.length === 1 ? 'report' : 'reports'}.
            Analytes the extractor did not find are not listed.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col">
          {collections.map((collection, i) => (
            <section key={`${collection.fileName ?? 'collection'}-${i}`} className="border-t">
              {multiple && (
                <div className="bg-muted/40 px-5 py-2">
                  <div className="text-[13px] font-semibold">
                    {collection.collectionDate
                      ? `Collected ${collection.collectionDate}`
                      : `Collection ${i + 1}`}
                  </div>
                  {collection.fileName && (
                    <div className="truncate text-xs text-muted-foreground">
                      {collection.fileName}
                    </div>
                  )}
                </div>
              )}

              {collection.analytes.length ? (
                <dl className="flex flex-col">
                  {collection.analytes.map((a) => (
                    <div
                      key={a.name}
                      className="flex items-baseline justify-between gap-4 border-b px-5 py-2.5 last:border-b-0"
                    >
                      <dt className="text-[13px]">{a.name}</dt>
                      <dd className="text-[13px] font-semibold tabular-nums">{a.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="px-5 py-4 text-sm text-muted-foreground">
                  No values were extracted from this report.
                </p>
              )}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
