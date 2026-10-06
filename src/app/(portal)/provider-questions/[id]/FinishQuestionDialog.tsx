'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { consultLine } from '@/lib/consultations/request'
import { orderLine } from '@/lib/labOrders/order'
import { FLAG_LABELS } from '@/lib/labReviews/clinicalIds'
import type { AnswerDraft } from '@/lib/providerQuestions/answerDraft'
import { planAnswerDelivery, planFinish } from '@/lib/providerQuestions/finish'

import { useChartSummary } from '../../lab-reviews/[id]/useChartSummary'
import { finishProviderQuestionAction, questionRecapAction } from '../actions'

/**
 * The last screen before a Provider Question is finished: what the patient
 * will read, where it goes, what lands on the chart, and what else happens.
 *
 * Every string here comes from `planFinish` and `planAnswerDelivery`, so what
 * is approved is what gets written — the same rule the Lab Review confirmation
 * follows. The chart note's AI summary is generated on open from the plan's
 * structured events; the provider's answer itself is verbatim.
 *
 * Unlike the Lab Review, finishing is one server call, not a sequence of
 * sends: the answer is the irreversible step and everything else follows it
 * server-side, so there is nothing for a retry-per-step to recover.
 */

type Phase =
  | { kind: 'preview' }
  | { kind: 'sending' }
  | { kind: 'error'; message: string }

export function FinishQuestionDialog({
  questionId,
  question,
  csComments,
  zendeskTicketId,
  draft,
  patientName,
  patientFirstName,
  patientEmail,
  providerName,
  onEdit,
  onChartSummary,
  onQuestionRecap,
  onFinished,
}: {
  questionId: string
  question: string
  csComments: string | null
  zendeskTicketId: string | null
  draft: AnswerDraft
  patientName: string
  patientFirstName: string | null
  patientEmail: string | null
  providerName: string
  onEdit: () => void
  onChartSummary: (chartSummary: string) => void
  onQuestionRecap: (questionRecap: string) => void
  onFinished: (warning?: string) => void
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'preview' })
  // A new-ticket letter restates the question through an AI recap, written once
  // here so the provider approves the exact words. A reply needs none.
  const [recapPending, setRecapPending] = useState(
    () => !zendeskTicketId?.trim() && !draft.questionRecap.trim()
  )

  useEffect(() => {
    if (!recapPending) return
    let current = true
    questionRecapAction(questionId)
      .then((result) => {
        if (current && result.ok && result.recap) onQuestionRecap(result.recap)
      })
      .catch(() => {})
      .finally(() => {
        if (current) setRecapPending(false)
      })
    return () => {
      current = false
    }
    // Once per open: the question does not change while this dialog is up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const plan = planFinish({ question, csComments, draft, providerName })
  const delivery = planAnswerDelivery({
    ticketId: zendeskTicketId,
    answer: draft.patientMessage,
    firstName: patientFirstName,
    questionRecap: draft.questionRecap,
  })

  const summary = useChartSummary({
    events: plan.events,
    existing: draft.chartSummary,
    enabled: true,
    onReady: onChartSummary,
  })
  const sending = phase.kind === 'sending'

  const effects: string[] = [
    delivery.kind === 'reply'
      ? `The answer is posted as a reply on Zendesk ticket #${delivery.ticketId}, which emails the patient.`
      : `A new Zendesk ticket is opened to ${patientEmail ?? 'the patient'} with a short AI summary of what they asked (never the question text itself) and your answer. If a reply to the linked ticket fails, this is also the fallback.`,
    ...draft.labOrders.map((order) => `Labs ordered: ${orderLine(order)}`),
    draft.consultation
      ? `The booking link reserved for this question is emailed to ${patientEmail ?? 'the patient'}: ${consultLine(draft.consultation)}`
      : null,
    plan.addFlagIds.length
      ? `Flags the patient for customer service — ${plan.addFlagIds
          .map((id) => FLAG_LABELS[id] ?? id)
          .join(' and ')}, shown on Flagged Patients with the notes below.`
      : 'Nothing for customer service — no flag raised.',
    'Urgent is cleared and the question is marked Finished. It is never reopened; a later message from the patient is a new question.',
  ].filter((line): line is string => Boolean(line))

  const finish = async () => {
    if (sending) return
    setPhase({ kind: 'sending' })

    const result = await finishProviderQuestionAction(questionId, JSON.stringify(draft))
    if (result.status === 'error') {
      setPhase({ kind: 'error', message: result.message })
      return
    }
    onFinished(result.warning)
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !sending && onEdit()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Before you finish — {patientName}</DialogTitle>
          <DialogDescription>
            Read it the way the patient and the chart will. Nothing is sent until you press Finish.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
          <Card title={delivery.kind === 'reply' ? 'To the patient — reply on the ticket' : 'To the patient — new ticket'}>
            {recapPending ? (
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Summarising the patient&apos;s question for the letter…
              </p>
            ) : (
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{delivery.body}</p>
            )}
          </Card>

          <Card
            title="Onto the chart — Provider Question Note"
            action={
              <button
                type="button"
                onClick={() => void summary.generate()}
                disabled={summary.status === 'generating' || sending}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:no-underline disabled:opacity-50"
              >
                {summary.status === 'generating' ? 'Writing…' : 'Rewrite summary'}
              </button>
            }
          >
            {summary.status === 'error' && (
              <p role="alert" className="text-xs text-destructive">
                {summary.error} The note will open with a plain line instead of a summary.
              </p>
            )}
            {summary.status === 'generating' && (
              <p className="text-xs text-muted-foreground">
                You can finish without waiting. The chart note will use a plain line until a summary arrives.
              </p>
            )}
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap">
              {summary.status === 'generating'
                ? summary.streaming || 'Summarising what you did…'
                : plan.note}
            </p>
          </Card>

          {plan.addFlagIds.map((id) =>
            plan.flagNotes[id] ? (
              <Card key={id} title={`For customer service — ${FLAG_LABELS[id] ?? id} flag`}>
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap">
                  {plan.flagNotes[id]}
                </p>
              </Card>
            ) : null
          )}

          <Card title="What happens">
            <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] leading-relaxed">
              {effects.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Card>

          {phase.kind === 'error' && (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] font-medium text-destructive"
            >
              {phase.message}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onEdit} disabled={sending}>
            Go back and edit
          </Button>
          <Button onClick={() => void finish()} disabled={sending || recapPending}>
            {sending && <Loader2 className="animate-spin" />}
            {phase.kind === 'error' ? 'Try again' : 'Finish — send answer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Card({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-muted/30 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}
