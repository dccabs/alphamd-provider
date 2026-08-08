'use client'

import { useState } from 'react'
import { ChevronDown, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SummaryBlocks } from '@/components/summary-blocks'
import type { Block } from '@/lib/labReviews/summaryMarkdown'

export type Analyte = { name: string; value: string }

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
  collectionDate,
  summaryStatus,
  summaryError,
}: {
  blocks: Block[]
  analytes: Analyte[]
  collectionDate: string | null
  summaryStatus: string | null
  summaryError: string | null
}) {
  const [open, setOpen] = useState(false)

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
            <span className="text-xs text-muted-foreground">+{analytes.length - 4} more</span>
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
    </div>
  )
}
