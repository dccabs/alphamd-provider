'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Check, ChevronLeft, MoreHorizontal, UserPlus } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { shortDate, statusTone } from '@/lib/labReviews/format'
import { MORE_ACTIONS, STATIC_NOTICES } from '@/lib/labReviews/fixtures'
import type { Note } from '@/lib/labReviews/notes'
import type { Block } from '@/lib/labReviews/summaryMarkdown'
import { signFileAction } from '../actions'
import { AiAnalysisCard, type Analyte } from './AiAnalysisCard'
import { DetailTabs } from './DetailTabs'
import { DocumentViewer } from './DocumentViewer'
import { ReviewModal } from './ReviewModal'
import type { CsThread, Medication, Order, PatientFile } from './types'

export type PatientHeader = {
  patientId: string
  name: string
  status: string | null
  age: number | null
  gender: string | null
  dateOfBirth: string | null
  phone: string | null
  email: string | null
  address: string | null
  flags: string[]
  protocol: string | null
}

export function LabReviewScreen({
  header,
  reviewStatus,
  assignedToName,
  queuePosition,
  queueTotal,
  viewerName,
  summaryBlocks,
  summaryStatus,
  summaryError,
  summaryGeneratedAt,
  analytes,
  collectionDate,
  notes,
  medications,
  orders,
  files,
  cs,
  initialFile,
  initialSignedUrl,
  initialSignError,
}: {
  header: PatientHeader
  reviewStatus: string
  assignedToName: string | null
  queuePosition: number | null
  queueTotal: number
  viewerName: string
  summaryBlocks: Block[]
  summaryStatus: string | null
  summaryError: string | null
  summaryGeneratedAt: string | null
  analytes: Analyte[]
  collectionDate: string | null
  notes: Note[]
  medications: Medication[]
  orders: Order[]
  files: PatientFile[]
  cs: CsThread
  initialFile: PatientFile | null
  initialSignedUrl: string | null
  initialSignError: string | null
}) {
  const [shownFile, setShownFile] = useState<PatientFile | null>(initialFile)
  const [signedUrl, setSignedUrl] = useState<string | null>(initialSignedUrl)
  const [signError, setSignError] = useState<string | null>(initialSignError)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [, startTransition] = useTransition()

  const showFile = (file: PatientFile) => {
    setShownFile(file)
    setSignedUrl(null)
    setSignError(null)
    startTransition(async () => {
      const result = await signFileAction(file.path)
      if (result.ok) setSignedUrl(result.url)
      else setSignError(result.error)
    })
  }

  const finalized = reviewStatus === 'finished'

  const demographics = [
    header.age != null ? String(header.age) : null,
    header.gender,
    header.dateOfBirth ? `DOB ${shortDate(header.dateOfBirth)}` : null,
    header.phone,
    header.email,
    header.address,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="min-h-screen bg-muted">
      <header className="flex h-13 items-center justify-between gap-4 border-b bg-card px-6 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5 text-[13px]">
          <Link
            href="/lab-reviews"
            className="inline-flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" />
            Lab reviews
          </Link>
          <span className="text-border">/</span>
          <span className="truncate font-semibold">{header.name}</span>
          {queuePosition && (
            <span className="rounded-full border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
              Review {queuePosition} of {queueTotal} in queue
            </span>
          )}
        </div>
        <span className="shrink-0 text-[13px] text-muted-foreground">{viewerName}</span>
      </header>

      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-6 pt-5 pb-8">
        <section className="flex flex-wrap items-start justify-between gap-4 rounded-xl border bg-card px-5 py-4">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">{header.name}</h1>
              {header.status &&
                (statusTone(header.status) === 'active' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700">
                    <span className="size-1.5 rounded-full bg-green-500" />
                    {header.status}
                    {header.protocol ? ` — ${header.protocol}` : ''}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-muted-foreground/60" />
                    {header.status}
                    {header.protocol ? ` — ${header.protocol}` : ''}
                  </span>
                ))}
            </div>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {demographics || 'No demographics on file'}
            </p>
            {header.flags.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {header.flags.map((flag) => (
                  <Badge key={flag} variant="destructive">
                    {flag}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="relative flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAssignOpen((v) => !v)
                setActionsOpen(false)
              }}
            >
              {assignedToName ? <Check /> : <UserPlus />}
              {assignedToName ? `Assigned · ${assignedToName}` : 'Assign'}
            </Button>

            <Button variant="outline" size="sm" onClick={() => setReviewOpen(true)}>
              {finalized ? <Check /> : null}
              {finalized ? 'Finalized' : 'Mark complete'}
            </Button>

            <Button
              variant="outline"
              size="icon-sm"
              aria-label="More actions"
              onClick={() => {
                setActionsOpen((v) => !v)
                setAssignOpen(false)
              }}
            >
              <MoreHorizontal />
            </Button>

            {assignOpen && (
              <div className="absolute top-10 right-0 z-40 w-72 rounded-lg border bg-card p-3.5 shadow-lg">
                <span className="text-xs font-bold tracking-wider text-muted-foreground">
                  ASSIGN TO PROVIDER
                </span>
                <p className="mt-2 text-xs text-muted-foreground">
                  Assignment lands in the next change — it writes
                  <code className="mx-1 rounded bg-muted px-1">lab_reviews.assigned_to</code>,
                  which already exists.
                </p>
                <Textarea
                  className="mt-2.5"
                  rows={2}
                  disabled
                  placeholder="Optional instructions for the provider…"
                  aria-label="Instructions for the provider"
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {STATIC_NOTICES.assignInstructions}
                </p>
              </div>
            )}

            {actionsOpen && (
              <div className="absolute top-10 right-0 z-40 flex w-64 flex-col rounded-lg border bg-card p-1.5 shadow-lg">
                {MORE_ACTIONS.map((action) => (
                  <span
                    key={action.id}
                    className="flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-[13px] text-muted-foreground"
                  >
                    {action.label}
                    <Badge variant="secondary">
                      {action.static ? 'Not wired' : 'Next change'}
                    </Badge>
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1fr_400px]">
          <div className="overflow-hidden rounded-xl border bg-card">
            <AiAnalysisCard
              blocks={summaryBlocks}
              analytes={analytes}
              collectionDate={collectionDate}
              summaryStatus={summaryStatus}
              summaryError={summaryError}
            />
            <DocumentViewer file={shownFile} signedUrl={signedUrl} error={signError} />
          </div>

          <DetailTabs
            notes={notes}
            summaryBlocks={summaryBlocks}
            summaryGeneratedAt={summaryGeneratedAt}
            medications={medications}
            orders={orders}
            files={files}
            cs={cs}
            shownFileId={shownFile?.id ?? null}
            onShowFile={showFile}
          />
        </div>
      </div>

      {reviewOpen && (
        <ReviewModal
          patientName={header.name}
          collectionDate={collectionDate}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </div>
  )
}
