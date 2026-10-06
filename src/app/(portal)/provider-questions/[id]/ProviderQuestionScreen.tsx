'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ChevronLeft, Flame, MessageCircleQuestion, Paperclip } from 'lucide-react'

import { PatientStatusPill } from '@/components/patient-status'
import { PortalChrome } from '@/components/portal-chrome'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { LabProviderOption, ScheduledLabOrder } from '@/lib/labOrders/queries'
import type { Consultation } from '@/lib/labReviews/consultations'
import { shortDate, shortDateTime } from '@/lib/labReviews/format'
import type { Note } from '@/lib/labReviews/notes'
import type { AnswerDraft } from '@/lib/providerQuestions/answerDraft'
import type { QuestionAttachment } from '@/lib/providerQuestions/attachmentView'
import { isAged, type ProviderQuestionStatus } from '@/lib/providerQuestions/queueRow'

import { signFileAction } from '../../lab-reviews/actions'
import { IDLE, type WriteState } from '../../lab-reviews/state'
import { DetailTabs } from '../../lab-reviews/[id]/DetailTabs'
import { DocumentViewer } from '../../lab-reviews/[id]/DocumentViewer'
import type { PatientHeader } from '../../lab-reviews/[id]/LabReviewScreen'
import { PatientSnapshot } from '../../lab-reviews/[id]/PatientSnapshot'
import type {
  CsInbox,
  DosageOption,
  LabReviewEvent,
  Medication,
  Order,
  PatientFile,
} from '../../lab-reviews/[id]/types'
import {
  cancelLabOrderAction,
  openAttachmentAction,
  saveAnswerDraftAction,
  setUrgentAction,
  takeProviderQuestionAction,
} from '../actions'
import { AnswerModal } from './AnswerModal'
import { InlineReply } from './InlineReply'
import { QuestionSummary } from './QuestionSummary'

/**
 * The exam room for a Provider Question.
 *
 * The same layout as a Lab Review — patient header and snapshot, the document
 * viewer, the right-hand tabs — built from the same parts, so a provider who
 * knows one knows the other. Two things differ, and both are on purpose: the
 * lab-values slot is the question and what customer service added, and the
 * page says Provider Question everywhere a Lab Review would say review.
 *
 * Nothing here is cloned from `LabReviewScreen`; the parts are imported. The
 * shell that is different (start / assign / needs attention) is a Lab Review
 * shell, and a Provider Question's is take-to-self and Urgent.
 */
export function ProviderQuestionScreen({
  questionId,
  header,
  status,
  question,
  csComments,
  attachments,
  urgent,
  zendeskTicketId,
  assignedTo,
  assignedToName,
  createdAt,
  createdByName,
  startedAt,
  finishedAt,
  finishedByName,
  resolution,
  answer,
  openCountForPatient,
  viewerId,
  viewerName,
  labProviders,
  scheduledLabs,
  events,
  draft,
  draftUpdatedAt,
  notes,
  medications,
  dosageOptions,
  orders,
  files,
  cs,
  consultations,
}: {
  questionId: string
  header: PatientHeader
  status: ProviderQuestionStatus
  question: string
  csComments: string | null
  attachments: QuestionAttachment[]
  urgent: boolean
  zendeskTicketId: string | null
  assignedTo: string | null
  assignedToName: string | null
  createdAt: string | null
  createdByName: string | null
  startedAt: string | null
  finishedAt: string | null
  finishedByName: string | null
  resolution: string | null
  answer: string | null
  openCountForPatient: number
  viewerId: string
  viewerName: string
  labProviders: LabProviderOption[]
  scheduledLabs: ScheduledLabOrder[]
  events: LabReviewEvent[]
  draft: AnswerDraft
  draftUpdatedAt: string | null
  notes: Note[]
  medications: Medication[]
  dosageOptions: DosageOption[]
  orders: Order[]
  files: PatientFile[]
  cs: CsInbox
  consultations: Consultation[]
}) {
  const [shownFile, setShownFile] = useState<PatientFile | null>(null)
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [signError, setSignError] = useState<string | null>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const [answerOpen, setAnswerOpen] = useState(false)
  const [answerSeed, setAnswerSeed] = useState<string | null>(null)
  const [write, setWrite] = useState<WriteState>(IDLE)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const finished = status === 'finished'
  const mine = assignedTo === viewerId
  const aged = isAged({ status, createdAt })

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

  const hideFile = () => {
    setShownFile(null)
    setSignedUrl(null)
    setSignError(null)
  }

  // The viewer sits under the question, often below the fold when the sidebar
  // button that opened it is still in view.
  const shownFileId = shownFile?.id ?? null
  useEffect(() => {
    if (shownFileId !== null) {
      viewerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [shownFileId])

  /** Take-to-self, then open the flyout — but only once the take succeeded. */
  const takeAndAnswer = () => {
    setWrite(IDLE)
    startTransition(async () => {
      const result = await takeProviderQuestionAction(questionId)
      setWrite(result)
      if (result.status !== 'error') {
        router.refresh()
        setAnswerOpen(true)
      }
    })
  }

  const toggleUrgent = () => {
    setWrite(IDLE)
    startTransition(async () => {
      setWrite(await setUrgentAction(questionId, !urgent))
      router.refresh()
    })
  }

  /** From the inline reply: carry its message into the panel, taking first if needed. */
  const openAnswerWith = (message: string) => {
    setWrite(IDLE)
    startTransition(async () => {
      if (!mine) {
        const taken = await takeProviderQuestionAction(questionId)
        setWrite(taken)
        if (taken.status === 'error') return
      }
      if (message !== draft.patientMessage) {
        const saved = await saveAnswerDraftAction(
          questionId,
          JSON.stringify({ ...draft, patientMessage: message })
        )
        if (saved.status === 'error') setWrite(saved)
      }
      setAnswerSeed(message)
      router.refresh()
      setAnswerOpen(true)
    })
  }

  const closeAnswer = () => {
    setAnswerOpen(false)
    setAnswerSeed(null)
    router.refresh()
  }

  const finishedWith = (warning?: string) => {
    setWrite(warning ? { status: 'ok', warning } : { status: 'ok' })
    closeAnswer()
  }

  const cancelOrder = (scheduledId: string) => {
    setWrite(IDLE)
    startTransition(async () => {
      setWrite(await cancelLabOrderAction(questionId, scheduledId))
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
    <>
      <PortalChrome
        displayName={viewerName}
        left={
          <>
            <Link
              href="/provider-questions"
              className="inline-flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-3.5" />
              Provider Questions
            </Link>
            <span className="text-border">/</span>
            <span className="truncate font-semibold">{header.name}</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-900">
              <MessageCircleQuestion className="size-3" />
              Provider Question
            </span>
          </>
        }
      />

      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-6 pt-5 pb-8">
        <section className="rounded-xl border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-semibold tracking-tight">{header.name}</h1>
                <PatientStatusPill status={header.status} />
                {urgent && !finished && (
                  <Badge variant="destructive">
                    <Flame className="size-3" /> Urgent
                  </Badge>
                )}
                {aged && (
                  <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-900">
                    Aged
                  </Badge>
                )}
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

            <div className="flex shrink-0 items-center gap-2">
              {!finished && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  aria-pressed={urgent}
                  onClick={toggleUrgent}
                  className={urgent ? 'text-destructive' : undefined}
                >
                  <Flame />
                  {urgent ? 'Clear Urgent' : 'Mark Urgent'}
                </Button>
              )}

              {finished ? (
                <Button variant="outline" size="sm" disabled>
                  <Check />
                  Finished
                </Button>
              ) : mine ? (
                <Button size="sm" disabled={pending} onClick={() => setAnswerOpen(true)}>
                  {draft.patientMessage.trim() ? 'Continue answer' : 'Answer'}
                </Button>
              ) : (
                <Button size="sm" disabled={pending} onClick={takeAndAnswer}>
                  {status === 'queued'
                    ? 'Take and answer'
                    : `Take over from ${assignedToName ?? 'current provider'}`}
                </Button>
              )}
            </div>
          </div>

          <PatientSnapshot
            medications={medications}
            orders={orders}
            consultations={consultations}
          />
        </section>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
          <span>
            Asked {shortDateTime(createdAt)}
            {createdByName ? ` by ${createdByName}` : ''}
          </span>
          {startedAt && (
            <span>
              · Taken {shortDateTime(startedAt)}
              {assignedToName ? ` · ${mine ? 'yours' : assignedToName}` : ''}
            </span>
          )}
          {finished && finishedAt && (
            <span>
              · Finished {shortDateTime(finishedAt)}
              {finishedByName ? ` by ${finishedByName}` : ''}
            </span>
          )}
          {openCountForPatient > 1 && !finished && (
            <span>· {openCountForPatient} open for this patient</span>
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

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1fr_400px] xl:items-stretch">
          <div className="overflow-hidden rounded-xl border bg-card">
            <QuestionCard
              questionId={questionId}
              question={question}
              csComments={csComments}
              attachments={attachments}
              finished={finished}
              resolution={resolution}
              answer={answer}
              zendeskTicketId={zendeskTicketId}
            />
            {!finished && !answerOpen && (
              <InlineReply
                key={draftUpdatedAt ?? 'none'}
                questionId={questionId}
                question={question}
                csComments={csComments}
                zendeskTicketId={zendeskTicketId}
                patientName={header.name}
                patientFirstName={header.firstName}
                patientEmail={header.email}
                providerName={viewerName}
                draft={draft}
                mine={mine}
                assignedToName={assignedToName}
                queued={status === 'queued'}
                onOpenAnswer={openAnswerWith}
                onFinished={finishedWith}
              />
            )}
            {shownFile && (
              <div ref={viewerRef} className="scroll-mt-4">
                <DocumentViewer
                  file={shownFile}
                  signedUrl={signedUrl}
                  error={signError}
                  onClose={hideFile}
                />
              </div>
            )}
          </div>

          {/* The tabs fill this box absolutely, so it needs its own height while no
              file is open and the question card alone would set the row. */}
          <div className="xl:relative xl:min-h-[720px]">
            <DetailTabs
              reviewId={questionId}
              notes={notes}
              summaryBlocks={[]}
              summaryGeneratedAt={null}
              aiPanel={<QuestionSummary questionId={questionId} />}
              files={files}
              cs={cs}
              events={events}
              reviewNotes={[]}
              shownFileId={shownFileId}
              onShowFile={showFile}
              filesHint="Files display in the main column when selected."
              activityTitle="Question history"
            />
          </div>
        </div>
      </div>

      {answerOpen && !finished && (
        <AnswerModal
          questionId={questionId}
          question={question}
          csComments={csComments}
          zendeskTicketId={zendeskTicketId}
          patientName={header.name}
          patientFirstName={header.firstName}
          patientEmail={header.email}
          patientStatusId={header.statusId}
          patientState={header.state}
          patientGender={header.gender}
          providerName={viewerName}
          medications={medications}
          dosageOptions={dosageOptions}
          labProviders={labProviders}
          scheduledLabs={scheduledLabs}
          consultations={consultations}
          cancellingLabOrder={pending}
          onCancelScheduledLab={cancelOrder}
          initialDraft={answerSeed === null ? draft : { ...draft, patientMessage: answerSeed }}
          draftUpdatedAt={draftUpdatedAt}
          onClose={closeAnswer}
          onFinished={finishedWith}
        />
      )}
    </>
  )
}

/**
 * The values slot. A Lab Review shows extracted analytes here; a Provider
 * Question shows the question, because that is what is being reviewed. Once
 * finished, the answer sits under it so the record reads whole.
 */
function QuestionCard({
  questionId,
  question,
  csComments,
  attachments,
  finished,
  resolution,
  answer,
  zendeskTicketId,
}: {
  questionId: string
  question: string
  csComments: string | null
  attachments: QuestionAttachment[]
  finished: boolean
  resolution: string | null
  answer: string | null
  zendeskTicketId: string | null
}) {
  return (
    <section className="flex flex-col gap-3 border-b border-violet-200 bg-violet-50/50 px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-violet-900 uppercase">
          <MessageCircleQuestion className="size-3.5" />
          Provider Question
        </h2>
        <span className="text-xs text-violet-900/70">
          {zendeskTicketId ? `Zendesk ticket #${zendeskTicketId}` : 'No ticket yet — answer opens one'}
        </span>
      </div>

      <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{question}</p>

      {csComments?.trim() && (
        <div className="rounded-md border border-violet-200 bg-card px-3.5 py-2.5">
          <p className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
            Customer service adds
          </p>
          <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap">{csComments}</p>
        </div>
      )}

      {attachments.length > 0 && (
        <AttachmentList questionId={questionId} attachments={attachments} />
      )}

      {finished && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3.5 py-2.5">
          <p className="text-[11px] font-bold tracking-wider text-green-900 uppercase">
            Answer{resolution ? ` · ${resolution}` : ''}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap">
            {answer ?? 'No answer recorded.'}
          </p>
        </div>
      )}
    </section>
  )
}

function formatSize(bytes: number | null): string | null {
  if (bytes == null) return null
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * What customer service attached for the provider. Each file says where it
 * came from. Zendesk files link straight to Zendesk; uploads are signed on
 * click, so a page left open for hours still opens them.
 */
function AttachmentList({
  questionId,
  attachments,
}: {
  questionId: string
  attachments: QuestionAttachment[]
}) {
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  const openUpload = async (attachment: QuestionAttachment) => {
    setError(null)
    setOpening(attachment.id)
    // Opened before the await: a window opened after it is a popup the browser blocks.
    const tab = window.open('about:blank', '_blank')
    try {
      const result = await openAttachmentAction(questionId, attachment.id)
      if (result.ok && tab) {
        tab.opener = null
        tab.location.href = result.url
      } else {
        tab?.close()
        setError(result.ok ? 'Allow pop-ups for this site to open attachments.' : result.error)
      }
    } catch {
      tab?.close()
      setError('Could not open this attachment.')
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className="rounded-md border border-violet-200 bg-card px-3.5 py-2.5">
      <p className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
        Attachments · for you, not sent to the patient
      </p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {attachments.map((attachment) => {
          const size = formatSize(attachment.sizeBytes)
          const label = (
            <>
              <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{attachment.fileName}</span>
              {size && <span className="shrink-0 text-xs text-muted-foreground">{size}</span>}
            </>
          )
          const linkClass =
            'flex min-w-0 items-center gap-1.5 text-left text-[13px] text-primary hover:underline disabled:opacity-60'
          return (
            <li key={attachment.id} className="flex items-center justify-between gap-3">
              {attachment.href ? (
                <a href={attachment.href} target="_blank" rel="noreferrer" className={linkClass}>
                  {label}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => openUpload(attachment)}
                  disabled={opening === attachment.id}
                  className={linkClass}
                >
                  {label}
                </button>
              )}
              <Badge
                variant="outline"
                className={
                  attachment.source === 'zendesk'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-blue-200 bg-blue-50 text-blue-800'
                }
              >
                {attachment.mark}
              </Badge>
            </li>
          )
        })}
      </ul>
      {error && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
