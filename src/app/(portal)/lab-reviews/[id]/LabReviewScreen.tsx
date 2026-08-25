'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ChevronLeft, MoreHorizontal, Play, TriangleAlert, UserPlus } from 'lucide-react'

import { PatientStatusPill } from '@/components/patient-status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { LabProviderOption, ScheduledLabOrder } from '@/lib/labOrders/queries'
import type { Analyte } from '@/lib/labReviews/analytes'
import type { Consultation } from '@/lib/labReviews/consultations'
import { shortDate, shortDateTime } from '@/lib/labReviews/format'
import type { Escalation } from '@/lib/labReviews/needsAttention'
import type { Note } from '@/lib/labReviews/notes'
import type { ReviewDraft } from '@/lib/labReviews/reviewDraft'
import type { Block } from '@/lib/labReviews/summaryMarkdown'
import {
  cancelLabOrderAction,
  escalateLabReviewAction,
  reassignLabReviewAction,
  signFileAction,
  startLabReviewAction,
} from '../actions'
import { IDLE, type WriteState } from '../state'
import { DetailTabs } from './DetailTabs'
import { EscalatePanel } from './EscalatePanel'
import { DocumentViewer } from './DocumentViewer'
import { LabValuesCard } from './LabValuesCard'
import { PatientSnapshot } from './PatientSnapshot'
import { ReviewModal } from './ReviewModal'
import type {
  CatalogMedication,
  CsInbox,
  DosageOption,
  LabReviewEvent,
  LabReviewNote,
  Medication,
  Order,
  PatientFile,
  ProviderOption,
} from './types'

export type PatientHeader = {
  patientId: string
  name: string
  /** What the patient is called, which is what a message to them opens with. */
  firstName: string | null
  status: string | null
  statusId: number | null
  age: number | null
  gender: string | null
  dateOfBirth: string | null
  phone: string | null
  email: string | null
  address: string | null
  state: string | null
  flags: string[]
}

export function LabReviewScreen({
  reviewId,
  header,
  reviewStatus,
  assignedTo,
  assignedToName,
  startedAt,
  startedByName,
  queuePosition,
  queueTotal,
  viewerId,
  viewerName,
  providers,
  labProviders,
  scheduledLabs,
  events,
  reviewNotes,
  needsAttentionReason,
  draft,
  draftUpdatedAt,
  summaryBlocks,
  summaryStatus,
  summaryError,
  summaryGeneratedAt,
  analytes,
  collectionDate,
  sourceFileName,
  notes,
  medications,
  catalog,
  dosageOptions,
  orders,
  files,
  cs,
  consultations,
  initialFile,
  initialSignedUrl,
  initialSignError,
}: {
  reviewId: string
  header: PatientHeader
  reviewStatus: string
  assignedTo: string | null
  assignedToName: string | null
  startedAt: string | null
  startedByName: string | null
  queuePosition: number | null
  queueTotal: number
  viewerId: string
  /** The signed-in provider, by the name that will be written onto the chart. */
  viewerName: string
  providers: ProviderOption[]
  /** Signing providers for a requisition — `lab_providers`, which is a different
   *  table from the portal's own user accounts. */
  labProviders: LabProviderOption[]
  scheduledLabs: ScheduledLabOrder[]
  events: LabReviewEvent[]
  reviewNotes: LabReviewNote[]
  needsAttentionReason: string | null
  draft: ReviewDraft
  draftUpdatedAt: string | null
  summaryBlocks: Block[]
  summaryStatus: string | null
  summaryError: string | null
  summaryGeneratedAt: string | null
  analytes: Analyte[]
  collectionDate: string | null
  sourceFileName: string | null
  notes: Note[]
  medications: Medication[]
  /** Everything a protocol can be added to, for a new medication. */
  catalog: CatalogMedication[]
  /** Every dose in the catalog, which a dose change and a new medication both
   *  pick from. Keyed by `medicationId`, not by the patient's row. */
  dosageOptions: DosageOption[]
  orders: Order[]
  files: PatientFile[]
  cs: CsInbox
  consultations: Consultation[]
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
  const [escalateOpen, setEscalateOpen] = useState(false)
  const [write, setWrite] = useState<WriteState>(IDLE)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

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

  /**
   * The Files tab can point the viewer at any of the patient's files, which
   * leaves the extracted values describing a document that is no longer on
   * screen. The way back is a fresh sign rather than the URL the page arrived
   * with: signed links last an hour and a review can be open for longer.
   */
  const offReviewFile = Boolean(initialFile && shownFile?.id !== initialFile.id)
  const backToReviewFile = () => {
    if (initialFile) showFile(initialFile)
  }

  const finalized = reviewStatus === 'finished'
  const started = Boolean(startedAt)
  const mine = assignedTo === viewerId

  /**
   * "Start Lab Review" claims the review *and* opens the flyout, but only opens
   * it once the claim succeeded. Opening first would invite a provider to write a
   * disposition into a review that turned out to belong to somebody else.
   */
  const start = () => {
    setWrite(IDLE)
    startTransition(async () => {
      const result = await startLabReviewAction(reviewId)
      setWrite(result)
      if (result.status !== 'error') setReviewOpen(true)
    })
  }

  /**
   * Autosave deliberately does not revalidate — that would re-render the page
   * under a provider mid-sentence. Refreshing once on close is what brings the
   * History tab and the rehydrated draft back in step.
   */
  const closeReview = () => {
    setReviewOpen(false)
    router.refresh()
  }

  const reassign = (toUserId: string) => {
    setWrite(IDLE)
    setAssignOpen(false)
    startTransition(async () => {
      setWrite(await reassignLabReviewAction(reviewId, toUserId))
    })
  }

  const escalate = (escalation: Escalation) => {
    setWrite(IDLE)
    startTransition(async () => {
      const result = await escalateLabReviewAction(reviewId, {
        targets: escalation.targets,
        note: escalation.note,
        toProviderId: escalation.toProviderId,
      })
      setWrite(result)
      // The panel stays open on failure so the note is not lost.
      if (result.status !== 'error') setEscalateOpen(false)
    })
  }

  /**
   * Cancelling is the one lab-order action that happens the moment it is pressed.
   * The orders composed inside the flyout wait for approval, but a row that is
   * already `pending` is one the main app's cron may act on within minutes, so
   * "cancel it" cannot mean "cancel it when I am finished writing".
   */
  const cancelOrder = (scheduledId: string) => {
    setWrite(IDLE)
    startTransition(async () => {
      setWrite(await cancelLabOrderAction(reviewId, scheduledId))
      router.refresh()
    })
  }

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
        {/* No `overflow-hidden` here: the Assign and More-actions dropdowns are
            positioned absolutely inside this card and would be clipped. */}
        <section className="rounded-xl border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-semibold tracking-tight">{header.name}</h1>
                <PatientStatusPill status={header.status} />
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
                disabled={pending || finalized}
                onClick={() => {
                  setAssignOpen((v) => !v)
                  setActionsOpen(false)
                }}
              >
                {assignedToName ? <Check /> : <UserPlus />}
                {assignedToName
                  ? mine
                    ? 'Assigned · you'
                    : `Assigned · ${assignedToName}`
                  : 'Assign'}
              </Button>

              {finalized ? (
                <Button variant="outline" size="sm" disabled>
                  <Check />
                  Finalized
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={started ? () => setReviewOpen(true) : start}
                >
                  {started ? null : <Play />}
                  {started ? 'Continue review' : 'Start Lab Review'}
                </Button>
              )}

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
                <div className="absolute top-10 right-0 z-40 flex w-72 flex-col rounded-lg border bg-card p-1.5 shadow-lg">
                  <span className="px-2 py-1.5 text-xs font-bold tracking-wider text-muted-foreground">
                    ASSIGN TO PROVIDER
                  </span>
                  {providers.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                      No provider accounts found.
                    </p>
                  ) : (
                    providers.map((provider) => (
                      <button
                        key={provider.userId}
                        type="button"
                        disabled={pending || provider.userId === assignedTo}
                        onClick={() => reassign(provider.userId)}
                        className="flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-muted disabled:text-muted-foreground disabled:hover:bg-transparent"
                      >
                        {provider.name}
                        {provider.userId === assignedTo && <Check className="size-3.5" />}
                      </button>
                    ))
                  )}
                </div>
              )}

              {actionsOpen && (
                <div className="absolute top-10 right-0 z-40 flex w-64 flex-col rounded-lg border bg-card p-1.5 shadow-lg">
                  <button
                    type="button"
                    disabled={pending || finalized}
                    onClick={() => {
                      setActionsOpen(false)
                      setEscalateOpen(true)
                    }}
                    className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-muted disabled:text-muted-foreground disabled:hover:bg-transparent"
                  >
                    <TriangleAlert className="size-3.5" />
                    Mark needs attention
                  </button>
                </div>
              )}

              {escalateOpen && (
                <EscalatePanel
                  reviewId={reviewId}
                  providers={providers}
                  currentAssignee={assignedTo}
                  pending={pending}
                  onCancel={() => setEscalateOpen(false)}
                  onSubmit={escalate}
                />
              )}
            </div>
          </div>

          <PatientSnapshot
            medications={medications}
            orders={orders}
            consultations={consultations}
          />
        </section>

        {reviewStatus === 'needs_attention' && needsAttentionReason && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 text-[13px] text-amber-900">
            <span className="font-semibold">Needs attention:</span> {needsAttentionReason}
          </p>
        )}

        {(started || write.status !== 'idle') && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs">
            {started && (
              <span className="text-muted-foreground">
                Started {shortDateTime(startedAt)}
                {startedByName ? ` by ${startedByName}` : ''}
              </span>
            )}
            {write.status === 'error' && (
              <span role="alert" className="font-medium text-destructive">
                {write.message}
              </span>
            )}
            {write.status === 'ok' && write.warning && (
              <span role="alert" className="font-medium text-amber-800">
                {write.warning}
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1fr_400px] xl:items-stretch">
          <div className="overflow-hidden rounded-xl border bg-card">
            <LabValuesCard
              analytes={analytes}
              collectionDate={collectionDate}
              sourceFileName={sourceFileName}
              summaryStatus={summaryStatus}
              summaryError={summaryError}
              offReviewFile={offReviewFile}
              shownFileName={shownFile?.name ?? null}
              onBackToReviewFile={backToReviewFile}
            />
            <DocumentViewer file={shownFile} signedUrl={signedUrl} error={signError} />
          </div>

          {/*
            The tabs are lifted out of the grid's height calculation so the row
            is measured from the viewer alone, then stretched back over it.
            Sizing them by their own content instead would let a patient with a
            long history stretch the row past the page, and a hardcoded height
            drifts the moment the values card grows a row.
          */}
          <div className="xl:relative">
            <DetailTabs
              reviewId={reviewId}
              notes={notes}
              summaryBlocks={summaryBlocks}
              summaryGeneratedAt={summaryGeneratedAt}
              files={files}
              cs={cs}
              events={events}
              reviewNotes={reviewNotes}
              shownFileId={shownFile?.id ?? null}
              onShowFile={showFile}
            />
          </div>
        </div>
      </div>

      {reviewOpen && (
        <ReviewModal
          reviewId={reviewId}
          patientName={header.name}
          patientFirstName={header.firstName}
          providerName={viewerName}
          patientStatus={header.status}
          patientStatusId={header.statusId}
          patientState={header.state}
          patientEmail={header.email}
          patientGender={header.gender}
          collectionDate={collectionDate}
          medications={medications}
          catalog={catalog}
          dosageOptions={dosageOptions}
          labProviders={labProviders}
          scheduledLabs={scheduledLabs}
          consultations={consultations}
          cancellingLabOrder={pending}
          onCancelScheduledLab={cancelOrder}
          initialDraft={draft}
          draftUpdatedAt={draftUpdatedAt}
          onClose={closeReview}
          onFinalized={(warning) => {
            setWrite(warning ? { status: 'ok', warning } : { status: 'ok' })
            closeReview()
          }}
        />
      )}
    </div>
  )
}
