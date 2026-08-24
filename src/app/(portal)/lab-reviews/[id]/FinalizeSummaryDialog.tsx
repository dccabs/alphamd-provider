'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Loader2 } from 'lucide-react'
import Link from 'next/link'

import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { consultLine } from '@/lib/consultations/request'
import { orderLine, scheduledDateFor } from '@/lib/labOrders/order'
import { FLAG_LABELS, PATIENT_STATUS_LABELS } from '@/lib/labReviews/clinicalIds'
import {
  planCompletion,
  reviewAudiences,
  type ProtocolOutcome,
} from '@/lib/labReviews/completion'
import { shortDate } from '@/lib/labReviews/format'
import { DISPOSITION_LABELS, type ReviewDraft } from '@/lib/labReviews/reviewDraft'
import { REPLY_IDENTITY_LABELS, type ReplyIdentity } from '@/lib/labReviews/replyIdentity'
import {
  applyLabReviewFollowUpAction,
  closeLabReviewAction,
  previewProtocolAction,
  sendPatientLabReviewMessageAction,
  sendRecommendedProtocolAction,
  writeLabReviewChartNoteAction,
} from '../actions'

/**
 * The last screen before a review is finished: everything it will do, in one
 * place, read-only.
 *
 * Finishing is the widest write in the portal — a note onto the chart, flags on
 * and off, sometimes the patient's status, a message to the patient, and any lab
 * order or consultation invitation composed in the review — and until now the
 * provider committed all of it from a button with no preview. The
 * three destination cards are the substance: the same words, going to three
 * different readers, is the thing that is easy to get subtly wrong and
 * impossible to see while writing them in separate boxes.
 *
 * Every string here comes from `planCompletion` and `reviewAudiences` rather than
 * being composed for display, so what is approved is what gets written. The
 * chart is the exception that proves it: the provider's note is verbatim, and
 * the rest is an AI summary generated on open from the same events.
 *
 * **Precondition:** `validateCompletion(draft)` must be empty. Both functions
 * throw without a disposition, which is deliberate — a summary of an incoherent
 * review would be a summary of something that cannot happen.
 *
 * Approve swaps this preview for an animated list of the writes, then closes
 * the review. The preview stays put until they confirm.
 */

type PatientSend =
  | { status: 'idle' }
  | { status: 'creating' }
  | { status: 'skipped' }
  | { status: 'sent'; ticketId: number; sentAs: ReplyIdentity; warning?: string }
  | { status: 'error'; message: string }

type ProtocolSend =
  | { status: 'idle' }
  | { status: 'creating' }
  | { status: 'skipped' }
  | { status: 'handed-off' }
  | { status: 'sent'; snapshotId: string; warning?: string }
  | { status: 'error'; message: string }

type FollowUpSend =
  | { status: 'idle' }
  | { status: 'creating' }
  | {
      status: 'applied'
      actionId: string | null
      addedFlagIds: number[]
      removedFlagIds: number[]
      warning?: string
    }
  | { status: 'error'; message: string }

type ChartNoteSend =
  | { status: 'idle' }
  | { status: 'creating' }
  | { status: 'written'; warning?: string }
  | { status: 'error'; message: string }

type CloseSend =
  | { status: 'idle' }
  | { status: 'creating' }
  | { status: 'closed'; warning?: string }
  | { status: 'error'; message: string }

type ApprovalPhase = 'preview' | 'working' | 'done'

function pause(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function FinalizeSummaryDialog({
  reviewId,
  draft,
  patientName,
  patientEmail,
  providerName,
  onEdit,
  onChartSummary,
  onFinished,
}: {
  reviewId: string
  draft: ReviewDraft
  patientName: string
  /** Where a consultation invitation would be sent, named here because approving
   *  is what sends it. */
  patientEmail: string | null
  /** The name the chart note will be signed with. */
  providerName: string
  onEdit: () => void
  onChartSummary: (chartSummary: string) => void
  onFinished: () => void
}) {
  const [phase, setPhase] = useState<ApprovalPhase>('preview')
  const [patientSend, setPatientSend] = useState<PatientSend>({ status: 'idle' })
  const [protocolSend, setProtocolSend] = useState<ProtocolSend>({ status: 'idle' })
  const [followUpSend, setFollowUpSend] = useState<FollowUpSend>({ status: 'idle' })
  const [chartNoteSend, setChartNoteSend] = useState<ChartNoteSend>({ status: 'idle' })
  const [closeSend, setCloseSend] = useState<CloseSend>({ status: 'idle' })
  const quote = useProtocolPreview(draft)
  const protocolForSummary = quote.state === 'ready' ? quote.outcome : null
  const events =
    quote.state === 'ready'
      ? planCompletion(draft, providerName, protocolForSummary).events
      : ''
  const summary = useChartSummary({
    events,
    existing: draft.chartSummary,
    enabled: quote.state === 'ready',
    onReady: onChartSummary,
  })
  const summarizing =
    summary.status === 'generating' ||
    (!draft.chartSummary.trim() && summary.status !== 'error')
  const sending =
    patientSend.status === 'creating' ||
    protocolSend.status === 'creating' ||
    followUpSend.status === 'creating' ||
    chartNoteSend.status === 'creating' ||
    closeSend.status === 'creating'
  const canGoBack = phase === 'preview' && !sending
  const canRetry =
    patientSend.status === 'error' ||
    protocolSend.status === 'error' ||
    followUpSend.status === 'error' ||
    chartNoteSend.status === 'error' ||
    closeSend.status === 'error'

  // Nothing is rendered until the pricing is known, rather than rendering the
  // cards and filling the price in when it arrives. Two of the cards *contain* the
  // quote — a provider who read the customer service text a moment before it
  // gained a line about money has read something that was never true.
  if (quote.state !== 'ready') {
    return (
      <Dialog open onOpenChange={(next) => !next && onEdit()}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Before you finish — {patientName}</DialogTitle>
            <DialogDescription aria-live="polite">
              {quote.state === 'loading'
                ? 'Pricing the recommended protocol…'
                : 'The protocol could not be priced just now. Go back, then try again — nothing has been submitted.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onEdit}>
              Go back and edit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  const protocol = quote.outcome
  const plan = planCompletion(draft, providerName, protocol)
  const audiences = reviewAudiences(draft, providerName, protocol)
  const { disposition, doseChanges, newMedications, labOrders, consultation } = plan.detail

  const effects = [
    ...plan.removeFlagIds.map((id) => `Clears the "${FLAG_LABELS[id] ?? id}" flag.`),
    ...plan.addFlagIds.map((id) => `Adds the "${FLAG_LABELS[id] ?? id}" flag.`),
    plan.patientStatusId === null
      ? null
      : `Patient status becomes "${PATIENT_STATUS_LABELS[plan.patientStatusId] ?? plan.patientStatusId}".`,
    // The one effect that leaves the building. Named apart from the order itself
    // because approving is what sends it, and when it arrives is the part a
    // provider is deciding about.
    ...labOrders.map((order) => {
      if (order.timing === 'now') {
        return 'The lab order is placed and emailed to the patient within a few minutes.'
      }
      const date = scheduledDateFor(order.timing, order.customDate)
      return `The patient is emailed a heads-up now, and the order itself on ${
        date ? shortDate(date.toISOString()) : 'the date on the order'
      }.`
    }),
    // Reserved when the provider attached it, so approving only sends it. Said
    // plainly because "a link is created" would suggest it could still fail here.
    consultation
      ? `The booking link already reserved for this review is emailed to ${patientEmail ?? 'the patient'}, and stops working once they book.`
      : null,
    // The heaviest of them, and last, matching the order it actually runs in.
    protocol?.kind === 'quote'
      ? `The protocol and its price are emailed to ${patientEmail ?? 'the patient'}, and the consents it requires are requested separately. Nothing is charged until the patient approves it themselves.`
      : null,
    protocol?.kind === 'quote'
      ? 'The quote is saved to the patient\'s record, so they can find it by logging in.'
      : null,
  ].filter(Boolean)

  const approve = async () => {
    if (sending || summarizing) return

    setPhase('working')

    const sendProtocolNow = protocolSend.status === 'idle' || protocolSend.status === 'error'
    const sendPatient = patientSend.status === 'idle' || patientSend.status === 'error'
    const sendFollowUp = followUpSend.status === 'idle' || followUpSend.status === 'error'
    const sendChartNote = chartNoteSend.status === 'idle' || chartNoteSend.status === 'error'
    const sendClose = closeSend.status === 'idle' || closeSend.status === 'error'

    if (sendProtocolNow) {
      if (!protocol) {
        setProtocolSend({ status: 'skipped' })
      } else {
        setProtocolSend({ status: 'creating' })
        const result = await sendRecommendedProtocolAction(reviewId, JSON.stringify(draft))
        if (result.status === 'error') {
          setProtocolSend({ status: 'error', message: result.message })
          return
        }
        if (result.status === 'skipped') setProtocolSend({ status: 'skipped' })
        else if (result.status === 'handed-off') setProtocolSend({ status: 'handed-off' })
        else {
          setProtocolSend({
            status: 'sent',
            snapshotId: result.snapshotId,
            warning: result.warning,
          })
        }
      }
      await pause(320)
    }

    if (sendPatient) {
      if (!draft.patientMessage.trim()) {
        setPatientSend({ status: 'skipped' })
      } else {
        setPatientSend({ status: 'creating' })
        const result = await sendPatientLabReviewMessageAction(reviewId, draft.patientMessage)
        if (result.status === 'error') {
          setPatientSend({ status: 'error', message: result.message })
          return
        }
        if (result.status === 'skipped') setPatientSend({ status: 'skipped' })
        else {
          setPatientSend({
            status: 'sent',
            ticketId: result.ticketId,
            sentAs: result.sentAs,
            warning: result.warning,
          })
        }
      }
      await pause(320)
    }

    if (sendFollowUp) {
      setFollowUpSend({ status: 'creating' })
      const result = await applyLabReviewFollowUpAction(reviewId, JSON.stringify(draft))
      if (result.status === 'error') {
        setFollowUpSend({ status: 'error', message: result.message })
        return
      }
      setFollowUpSend({
        status: 'applied',
        actionId: result.actionId,
        addedFlagIds: result.addedFlagIds,
        removedFlagIds: result.removedFlagIds,
        warning: result.warning,
      })
      await pause(320)
    }

    if (sendChartNote) {
      setChartNoteSend({ status: 'creating' })
      const snapshotId = protocolSend.status === 'sent' ? protocolSend.snapshotId : null
      const result = await writeLabReviewChartNoteAction(
        reviewId,
        JSON.stringify(draft),
        snapshotId
      )
      if (result.status === 'error') {
        setChartNoteSend({ status: 'error', message: result.message })
        return
      }
      setChartNoteSend({ status: 'written', warning: result.warning })
      await pause(320)
    }

    if (sendClose) {
      setCloseSend({ status: 'creating' })
      const result = await closeLabReviewAction(reviewId, JSON.stringify(draft))
      if (result.status !== 'ok') {
        setCloseSend({
          status: 'error',
          message: result.status === 'error' ? result.message : 'Could not finish this review.',
        })
        return
      }
      setCloseSend({ status: 'closed', warning: result.warning })
      setPhase('done')
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (next || sending) return
        if (phase === 'done') onFinished()
        else if (canGoBack) onEdit()
      }}
    >
      {/* Preview stays 4xl so the cards are readable. The approval run is a
          short list, so it narrows. */}
      <DialogContent
        className={
          phase === 'preview'
            ? 'flex max-h-[90dvh] w-full flex-col gap-0 overflow-hidden sm:max-w-4xl'
            : 'flex max-h-[90dvh] w-full flex-col gap-0 overflow-hidden sm:max-w-lg'
        }
        showCloseButton={phase !== 'working'}
      >
        <DialogHeader className="shrink-0 pb-4 pr-8">
          <DialogTitle>
            {phase === 'done' ? 'Lab review finished' : `Before you finish — ${patientName}`}
          </DialogTitle>
          <DialogDescription>
            {phase === 'working'
              ? 'Working through the approval.'
              : phase === 'done'
                ? 'This lab review has been finished.'
                : 'Nothing has been submitted. This is what finishing the review would send and record.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-t pt-4">
          {phase !== 'preview' ? (
            <ApprovalProgress
              protocol={protocolSend}
              patient={patientSend}
              followUp={followUpSend}
              chart={chartNoteSend}
              close={closeSend}
              finished={phase === 'done'}
            />
          ) : (
            <>
          <Section title="DECISION">
            <ul className="flex flex-col gap-1 text-[13px]">
              <li>{DISPOSITION_LABELS[disposition]}</li>
              {doseChanges.map((change) => (
                <li key={`dose-${change.medicationId}-${change.medication}`}>
                  {change.medication} — {change.from ? `${change.from} → ` : ''}
                  <span className="font-semibold">{change.value}</span>
                </li>
              ))}
              {newMedications.map((med) => (
                <li key={`med-${med.medicationId}-${med.name}`}>
                  New: {med.name}
                  {med.dose ? ` — ${med.dose}` : ''}
                </li>
              ))}
            </ul>
          </Section>

          {/* Its own section rather than a line in the decision, because it is
              the one thing here that reaches the patient's wallet: they are
              emailed a requisition and pay for whatever AlphaMD is not covering. */}
          {labOrders.length > 0 && (
            <Section title="LABS TO BE ORDERED">
              <ul className="flex flex-col gap-1.5">
                {labOrders.map((order, index) => (
                  <li
                    key={index}
                    className="rounded-lg border bg-muted/40 px-3 py-2.5 text-[13px] leading-relaxed"
                  >
                    <span className="font-medium">{orderLine(order)}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {[
                        order.diagnosisCodes.join(', ') || 'no diagnosis code',
                        order.requiredCodes.length
                          ? `${order.requiredCodes.length} the patient cannot remove`
                          : null,
                        order.compedCodes.length
                          ? `${order.compedCodes.length} covered by AlphaMD`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Also its own section: it is the other thing here that asks something
              of the patient, and the type decides how long they get and with
              whom — neither of which is obvious from "consultation requested". */}
          {consultation && (
            <Section title="CONSULTATION">
              <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-[13px] leading-relaxed">
                <span className="font-medium">{consultLine(consultation)}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Booking link reserved, to {patientEmail ?? 'no email address on file'}
                </span>
                {consultation.message && (
                  <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed">
                    “{consultation.message}”
                  </p>
                )}
              </div>
            </Section>
          )}

          {protocol && (
            <ProtocolSection
              protocol={protocol}
              status={<ProtocolSendStatus send={protocolSend} />}
            />
          )}

          {/* Named by reader rather than by field. The chart is the provider's
              own note plus a short summary of what else happened — not a paste
              of the other two documents. */}
          <Destination
            title="THE PATIENT RECEIVES"
            text={audiences.patient}
            empty="Nothing written — the patient will not hear from you about this review."
            status={<PatientSendStatus send={patientSend} />}
          />

          <Destination
            title="CUSTOMER SERVICE RECEIVES"
            text={audiences.customerService}
            empty="Nothing for customer service."
            status={<FollowUpActionStatus send={followUpSend} />}
          />

          <ChartRecords
            providerNote={draft.providerNote}
            summary={
              summary.status === 'generating' && summary.streaming
                ? summary.streaming
                : draft.chartSummary
            }
            snapshotLine={
              protocol?.kind === 'quote'
                ? 'Pricing snapshot: linked when the protocol is sent'
                : null
            }
            generating={summary.status === 'generating'}
            generated={Boolean(draft.chartSummary.trim())}
            error={summary.error}
            onRegenerate={() => void summary.generate()}
            send={chartNoteSend}
          />

          <Section title="IN THE QUEUE">
            <p className="text-[13px]">{plan.resolution}</p>
          </Section>

          {effects.length > 0 && (
            <Section title="WHAT ELSE HAPPENS">
              <ul className="flex flex-col gap-1 text-[13px] text-muted-foreground">
                {effects.map((effect) => (
                  <li key={effect}>{effect}</li>
                ))}
              </ul>
              <FollowUpFlagStatus send={followUpSend} />
            </Section>
          )}
            </>
          )}
        </div>

        <DialogFooter className="mt-4 shrink-0 items-center">
          {phase === 'done' ? (
            <Link href="/lab-reviews" className={buttonVariants()}>
              Back to the queue
            </Link>
          ) : phase === 'working' ? (
            canRetry && !sending ? (
              <Button onClick={() => void approve()}>Retry</Button>
            ) : null
          ) : (
            <>
              <Button variant="outline" onClick={onEdit} disabled={!canGoBack}>
                Go back and edit
              </Button>
              <Button onClick={() => void approve()} disabled={summarizing}>
                Approve
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function useChartSummary({
  events,
  existing,
  enabled,
  onReady,
}: {
  events: string
  existing: string
  enabled: boolean
  onReady: (text: string) => void
}) {
  const [streaming, setStreaming] = useState('')
  const [status, setStatus] = useState<'idle' | 'generating' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const autoStarted = useRef(false)

  const generate = useCallback(async () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setStatus('generating')
    setStreaming('')
    setError(null)

    try {
      const response = await fetch('/api/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'chartSummary', events }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        const message = (await response.text().catch(() => '')) || 'The assistant failed.'
        setError(message)
        setStatus('error')
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let text = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
        setStreaming(text)
      }

      const next = text.trim()
      if (!next) {
        setError('The assistant returned nothing.')
        setStatus('error')
        return
      }

      onReady(next)
      setStatus('idle')
    } catch (cause) {
      if (controller.signal.aborted) return
      console.error('[FinalizeSummaryDialog]', cause)
      setError('The assistant could not be reached.')
      setStatus('error')
    } finally {
      if (abort.current === controller) abort.current = null
    }
  }, [events, onReady])

  useEffect(() => {
    if (!enabled || !events.trim()) return
    if (existing.trim() || autoStarted.current) return
    autoStarted.current = true
    void generate()
  }, [enabled, events, existing, generate])

  useEffect(() => () => abort.current?.abort(), [])

  return { status, streaming, error, generate }
}

function ChartRecords({
  providerNote,
  summary,
  snapshotLine,
  generating,
  generated,
  error,
  onRegenerate,
  send,
}: {
  providerNote: string
  summary: string
  snapshotLine?: string | null
  generating: boolean
  generated: boolean
  error: string | null
  onRegenerate: () => void
  send: ChartNoteSend
}) {
  const note = providerNote.trim()

  return (
    <Section title="THE CHART RECORDS">
      {note ? (
        <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap">
          {note}
        </p>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
          Nothing entered in Note for the chart.
        </p>
      )}
      {summary ? (
        <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap">
          {summary}
        </p>
      ) : generating ? (
        <p
          aria-live="polite"
          className="flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground"
        >
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Writing a short summary of everything else…
        </p>
      ) : null}
      {snapshotLine && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">{snapshotLine}</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {(generated || error) && !generating && (
        <Button variant="outline" size="sm" className="self-start" onClick={onRegenerate}>
          Regenerate summary
        </Button>
      )}
      <ChartNoteStatus send={send} />
    </Section>
  )
}

type PreviewState =
  | { state: 'loading' }
  | { state: 'ready'; outcome: ProtocolOutcome | null }
  | { state: 'error' }

/**
 * Ask the server what the added medications come to.
 *
 * Fetched once when the summary opens, rather than kept live as the provider
 * types: the draft cannot change while this dialog is on top of the flyout, and a
 * price that moved under a provider mid-read is the one thing this screen exists to
 * prevent.
 *
 * A failure is a state, not a silent null. Rendering the summary without the quote
 * would present a review that sends a protocol as one that does not.
 */
type ProgressRow = {
  key: string
  running: string
  done: string
  skipped?: string
  state: 'waiting' | 'running' | 'done' | 'skipped' | 'error'
  detail?: string
}

function ApprovalProgress({
  protocol,
  patient,
  followUp,
  chart,
  close,
  finished,
}: {
  protocol: ProtocolSend
  patient: PatientSend
  followUp: FollowUpSend
  chart: ChartNoteSend
  close: CloseSend
  finished: boolean
}) {
  const rows: ProgressRow[] = [
    {
      key: 'protocol',
      running: 'Recommended protocol being sent',
      done: 'Recommended protocol sent',
      skipped: 'No protocol to send',
      state:
        protocol.status === 'idle'
          ? 'waiting'
          : protocol.status === 'creating'
            ? 'running'
            : protocol.status === 'error'
              ? 'error'
              : protocol.status === 'skipped'
                ? 'skipped'
                : 'done',
      detail: protocol.status === 'error' ? protocol.message : protocol.status === 'handed-off'
        ? 'Customer service will price this by hand'
        : undefined,
    },
    {
      key: 'patient',
      running: 'Patient message being sent',
      done: 'Patient message sent',
      skipped: 'No patient message to send',
      state:
        patient.status === 'idle'
          ? 'waiting'
          : patient.status === 'creating'
            ? 'running'
            : patient.status === 'error'
              ? 'error'
              : patient.status === 'skipped'
                ? 'skipped'
                : 'done',
      detail: patient.status === 'error' ? patient.message : undefined,
    },
    {
      key: 'cs',
      running: 'Customer service message being sent',
      done: 'Customer service notified',
      state:
        followUp.status === 'idle'
          ? 'waiting'
          : followUp.status === 'creating'
            ? 'running'
            : followUp.status === 'error'
              ? 'error'
              : 'done',
      detail: followUp.status === 'error' ? followUp.message : undefined,
    },
    {
      key: 'chart',
      running: 'Chart record being recorded',
      done: 'Chart record written',
      state:
        chart.status === 'idle'
          ? 'waiting'
          : chart.status === 'creating'
            ? 'running'
            : chart.status === 'error'
              ? 'error'
              : 'done',
      detail: chart.status === 'error' ? chart.message : undefined,
    },
    {
      key: 'close',
      running: 'Closing the lab review',
      done: 'Lab review closed',
      state:
        close.status === 'idle'
          ? 'waiting'
          : close.status === 'creating'
            ? 'running'
            : close.status === 'error'
              ? 'error'
              : 'done',
      detail: close.status === 'error' ? close.message : close.status === 'closed' ? close.warning : undefined,
    },
  ]

  return (
    <ol className="flex flex-col gap-2" aria-live="polite">
      {rows.map((row, index) => (
        <li
          key={row.key}
          className="flex items-start gap-3 rounded-lg border bg-muted/40 px-3 py-2.5 transition-all duration-300"
          style={{ animationDelay: `${index * 60}ms` }}
        >
          <StepGlyph state={row.state} />
          <div className="min-w-0 flex-1">
            <p
              className={
                row.state === 'waiting'
                  ? 'text-[13px] text-muted-foreground'
                  : row.state === 'error'
                    ? 'text-[13px] text-destructive'
                    : 'text-[13px]'
              }
            >
              {row.state === 'running'
                ? row.running
                : row.state === 'skipped'
                  ? row.skipped
                  : row.state === 'error'
                    ? row.running
                    : row.state === 'done'
                      ? row.done
                      : row.running}
            </p>
            {row.detail && (
              <p className="mt-0.5 text-xs text-muted-foreground">{row.detail}</p>
            )}
          </div>
        </li>
      ))}
      {finished && (
        <li className="pt-2 text-[15px] font-medium animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
          This lab review has been finished.
        </li>
      )}
    </ol>
  )
}

function StepGlyph({ state }: { state: ProgressRow['state'] }) {
  if (state === 'running') {
    return <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
  }
  if (state === 'done' || state === 'skipped') {
    return (
      <Check
        className="mt-0.5 size-4 shrink-0 animate-in zoom-in-50 duration-200"
        aria-hidden
      />
    )
  }
  if (state === 'error') {
    return (
      <span className="mt-0.5 size-4 shrink-0 text-center text-sm leading-4 text-destructive" aria-hidden>
        !
      </span>
    )
  }
  return <span className="mt-0.5 size-4 shrink-0 rounded-full border border-muted-foreground/40" aria-hidden />
}

function useProtocolPreview(draft: ReviewDraft): PreviewState {
  const [preview, setPreview] = useState<PreviewState>({ state: 'loading' })

  useEffect(() => {
    let live = true

    previewProtocolAction(JSON.stringify(draft))
      .then((outcome) => live && setPreview({ state: 'ready', outcome }))
      .catch(() => live && setPreview({ state: 'error' }))

    return () => {
      live = false
    }
    // Once, on open. The draft is frozen behind this dialog, and depending on it
    // would re-price on every render, because it arrives as a fresh object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return preview
}

/**
 * What the patient is being quoted, or why nobody could quote it.
 *
 * The most consequential card on this screen: approving is what emails a price,
 * and it is the only figure here the provider did not type themselves. So the
 * breakdown is shown in full rather than summarised to a total — a $50 topical
 * surcharge the provider did not expect is exactly the kind of thing that should
 * be caught before it reaches a patient's card.
 */
function ProtocolSection({
  protocol,
  status,
}: {
  protocol: ProtocolOutcome
  status?: ReactNode
}) {
  if (protocol.kind === 'handed-off') {
    return (
      <Section title="RECOMMENDED PROTOCOL">
        <div className="rounded-lg border border-dashed px-3 py-2.5 text-[13px] leading-relaxed">
          <span className="font-medium">No quote is emailed.</span> Customer service prices this
          protocol by hand and sends it.
          <ul className="mt-1.5 flex flex-col gap-1 text-xs text-muted-foreground">
            {protocol.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
        {status}
      </Section>
    )
  }

  return (
    <Section title="RECOMMENDED PROTOCOL">
      <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-[13px] leading-relaxed">
        <p className="font-semibold">{protocol.total} due today</p>
        {/* Pre-formatted: these are the same lines, aligned the same way, that the
            patient reads in their email. */}
        <pre className="mt-1.5 font-sans text-xs leading-relaxed whitespace-pre-wrap">
          {protocol.lines.join('\n')}
        </pre>
        <p className="mt-2 text-xs text-muted-foreground">{protocol.caveat}</p>
      </div>
      {status}
    </Section>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-bold tracking-wider text-muted-foreground">{title}</span>
      {children}
    </div>
  )
}

/** One reader's text, verbatim. The empty state says who will not hear anything
 *  rather than leaving a blank panel that reads as a rendering failure. */
function Destination({
  title,
  text,
  empty,
  status,
}: {
  title: string
  text: string
  empty?: string
  status?: ReactNode
}) {
  return (
    <Section title={title}>
      {text ? (
        <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap">
          {text}
        </p>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
          {empty}
        </p>
      )}
      {status}
    </Section>
  )
}

function ChartNoteStatus({ send }: { send: ChartNoteSend }) {
  if (send.status === 'idle') return null

  if (send.status === 'creating') {
    return (
      <p
        aria-live="polite"
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Writing the completion note to the chart…
      </p>
    )
  }

  if (send.status === 'error') {
    return (
      <p role="alert" className="text-xs text-destructive">
        {send.message}
      </p>
    )
  }

  return (
    <div aria-live="polite" className="flex flex-col gap-1">
      <p className="flex items-center gap-1.5 text-xs">
        <Check className="size-3.5" aria-hidden />
        Written to the chart
      </p>
      {send.warning && <p className="text-xs text-muted-foreground">{send.warning}</p>}
    </div>
  )
}

function FollowUpActionStatus({ send }: { send: FollowUpSend }) {
  if (send.status === 'idle') return null

  if (send.status === 'creating') {
    return (
      <p
        aria-live="polite"
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Creating the customer service action…
      </p>
    )
  }

  if (send.status === 'error') {
    return (
      <p role="alert" className="text-xs text-destructive">
        {send.message}
      </p>
    )
  }

  return (
    <div aria-live="polite" className="flex flex-col gap-1">
      <p className="flex items-center gap-1.5 text-xs">
        <Check className="size-3.5" aria-hidden />
        {send.actionId
          ? `Action created — assigned to customer service`
          : 'Nothing to assign — no customer service action created'}
      </p>
      {send.warning && <p className="text-xs text-muted-foreground">{send.warning}</p>}
    </div>
  )
}

function FollowUpFlagStatus({ send }: { send: FollowUpSend }) {
  if (send.status === 'idle' || send.status === 'creating') return null

  if (send.status === 'error') {
    return (
      <p role="alert" className="text-xs text-destructive">
        {send.message}
      </p>
    )
  }

  const removed = send.removedFlagIds
    .map((id) => FLAG_LABELS[id] ?? id)
    .join(', ')
  const added = send.addedFlagIds.map((id) => FLAG_LABELS[id] ?? id).join(', ')

  return (
    <div aria-live="polite" className="flex flex-col gap-1 text-xs">
      <p className="flex items-center gap-1.5">
        <Check className="size-3.5" aria-hidden />
        Flags updated
        {removed ? ` — cleared ${removed}` : ''}
        {added ? `; added ${added}` : ''}
      </p>
      {send.warning && <p className="text-muted-foreground">{send.warning}</p>}
    </div>
  )
}

function ProtocolSendStatus({ send }: { send: ProtocolSend }) {
  if (send.status === 'idle') return null

  if (send.status === 'creating') {
    return (
      <p
        aria-live="polite"
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Saving the quote and emailing it…
      </p>
    )
  }

  if (send.status === 'skipped') {
    return (
      <p aria-live="polite" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="size-3.5" aria-hidden />
        Nothing to send — no protocol on this review
      </p>
    )
  }

  if (send.status === 'handed-off') {
    return (
      <p aria-live="polite" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="size-3.5" aria-hidden />
        No quote emailed — customer service will price this by hand
      </p>
    )
  }

  if (send.status === 'error') {
    return (
      <p role="alert" className="text-xs text-destructive">
        {send.message}
      </p>
    )
  }

  return (
    <div aria-live="polite" className="flex flex-col gap-1">
      <p className="flex items-center gap-1.5 text-xs">
        <Check className="size-3.5" aria-hidden />
        Sent — quote saved to the patient&apos;s record
      </p>
      {send.warning && <p className="text-xs text-muted-foreground">{send.warning}</p>}
    </div>
  )
}

function PatientSendStatus({ send }: { send: PatientSend }) {
  if (send.status === 'idle') return null

  if (send.status === 'creating') {
    return (
      <p
        aria-live="polite"
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Creating Zendesk ticket…
      </p>
    )
  }

  if (send.status === 'skipped') {
    return (
      <p aria-live="polite" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="size-3.5" aria-hidden />
        Nothing to send — no ticket created
      </p>
    )
  }

  if (send.status === 'error') {
    return (
      <p role="alert" className="text-xs text-destructive">
        {send.message}
      </p>
    )
  }

  return (
    <div aria-live="polite" className="flex flex-col gap-1">
      <p className="flex items-center gap-1.5 text-xs">
        <Check className="size-3.5" aria-hidden />
        Sent — ticket #{send.ticketId} · {REPLY_IDENTITY_LABELS[send.sentAs]}
      </p>
      {send.warning && <p className="text-xs text-muted-foreground">{send.warning}</p>}
    </div>
  )
}
