'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { DictationTextarea } from '@/components/ui/dictation-textarea'
import { Label } from '@/components/ui/label'
import type { LabProviderOption, ScheduledLabOrder } from '@/lib/labOrders/queries'
import type { Consultation } from '@/lib/labReviews/consultations'
import { shortTime } from '@/lib/labReviews/format'
import { isAnswerDraftEmpty, type AnswerDraft } from '@/lib/providerQuestions/answerDraft'
import { describeAnswer, validateFinish } from '@/lib/providerQuestions/finish'

import { ConsultPanel } from '../../lab-reviews/[id]/ConsultPanel'
import { DoseChangePanel } from '../../lab-reviews/[id]/DoseChangePanel'
import { FieldAssistButton } from '../../lab-reviews/[id]/FieldAssistButton'
import { LabOrdersPanel } from '../../lab-reviews/[id]/LabOrdersPanel'
import type { DosageOption, Medication } from '../../lab-reviews/[id]/types'
import { saveAnswerDraftAction } from '../actions'
import { FinishQuestionDialog } from './FinishQuestionDialog'

/**
 * The answer flyout for a Provider Question.
 *
 * Finishing a Provider Question is answering it, so this opens on the message
 * to the patient and that is the one thing it insists on. The Lab Review
 * toolkit — dose change, labs, consultation, follow-up, a request from CS — is
 * below it, all optional, in the same panels the Lab Review flyout uses so a
 * dose change recorded here is written exactly like one recorded there.
 *
 * No disposition, and no step-by-step wizard: the wizard exists because a Lab
 * Review has decisions that depend on each other. An answer does not.
 *
 * Autosave is the same debounce as `ReviewModal`, into
 * `provider_questions.draft`, flushed on close.
 */

const DEBOUNCE_MS = 1200

type SaveState =
  | { kind: 'clean' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'warned'; message: string }
  | { kind: 'error'; message: string }

export function AnswerModal({
  questionId,
  question,
  csComments,
  zendeskTicketId,
  patientName,
  patientFirstName,
  patientEmail,
  patientStatusId,
  patientState,
  patientGender,
  providerName,
  medications,
  dosageOptions,
  labProviders,
  scheduledLabs,
  consultations,
  cancellingLabOrder,
  onCancelScheduledLab,
  initialDraft,
  draftUpdatedAt,
  onClose,
  onFinished,
}: {
  questionId: string
  question: string
  csComments: string | null
  /** Where the answer will go: a reply on this ticket, or a new one when null. */
  zendeskTicketId: string | null
  patientName: string
  patientFirstName: string | null
  patientEmail: string | null
  patientStatusId: number | null
  patientState: string | null
  patientGender: string | null
  providerName: string
  medications: Medication[]
  dosageOptions: DosageOption[]
  labProviders: LabProviderOption[]
  scheduledLabs: ScheduledLabOrder[]
  consultations: Consultation[]
  cancellingLabOrder: boolean
  onCancelScheduledLab: (scheduledId: string) => void
  initialDraft: AnswerDraft
  draftUpdatedAt: string | null
  onClose: () => void
  onFinished: (warning?: string) => void
}) {
  const [draft, setDraft] = useState<AnswerDraft>(initialDraft)
  const [save, setSave] = useState<SaveState>(
    draftUpdatedAt && !isAnswerDraftEmpty(initialDraft)
      ? { kind: 'saved', at: draftUpdatedAt }
      : { kind: 'clean' }
  )
  const [edits, setEdits] = useState(0)
  const [finishing, setFinishing] = useState(false)
  const [toolkitOpen, setToolkitOpen] = useState(() => !isToolkitEmpty(initialDraft))

  const latest = useRef(initialDraft)
  const unsaved = useRef(false)

  const update = (patch: Partial<AnswerDraft>) => {
    const next = { ...latest.current, ...patch }
    latest.current = next
    setDraft(next)
    unsaved.current = true
    setEdits((n) => n + 1)
  }

  const persist = useCallback(async () => {
    if (!unsaved.current) return

    const snapshot = latest.current
    setSave({ kind: 'saving' })
    const result = await saveAnswerDraftAction(questionId, JSON.stringify(snapshot))

    if (result.status === 'error') {
      setSave({ kind: 'error', message: result.message })
      return
    }
    if (latest.current === snapshot) unsaved.current = false

    const warning = result.status === 'ok' ? result.warning : undefined
    setSave(
      warning
        ? { kind: 'warned', message: warning }
        : { kind: 'saved', at: new Date().toISOString() }
    )
  }, [questionId])

  useEffect(() => {
    if (edits === 0) return
    const timer = setTimeout(() => void persist(), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [edits, persist])

  const close = () => {
    void persist()
    onClose()
  }

  const problems = validateFinish(draft)
  const recorded = (omit: 'patientMessage' | 'csInstructions') =>
    describeAnswer(draft, question, { omit })

  return (
    <Dialog
      open
      modal={false}
      onOpenChange={(open, details) => {
        if (open || details.reason === 'outside-press' || details.reason === 'focus-out') return
        close()
      }}
    >
      <DialogContent
        side="right"
        showOverlay={false}
        showCloseButton={false}
        className="flex w-[480px] max-w-[92vw] flex-col gap-0 bg-card p-0 sm:max-w-[92vw]"
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold tracking-tight">
              Answer — {patientName}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
              Provider Question
              {zendeskTicketId
                ? ` · replies on ticket #${zendeskTicketId}`
                : ' · opens a new ticket to the patient'}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <SaveIndicator state={save} />
            <DialogClose
              render={<Button variant="ghost" size="icon-sm" aria-label="Close answer" />}
            >
              <XIcon />
            </DialogClose>
          </div>
        </div>

        <SaveBanner state={save} onRetry={() => void persist()} />

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <section className="flex flex-col gap-2 rounded-lg border border-violet-200 bg-violet-50/60 px-3.5 py-3">
            <h3 className="text-[11px] font-bold tracking-wider text-violet-900 uppercase">
              The question
            </h3>
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{question}</p>
            {csComments?.trim() && (
              <p className="border-t border-violet-200 pt-2 text-xs leading-relaxed text-violet-900/80 whitespace-pre-wrap">
                <span className="font-semibold">Customer service adds:</span> {csComments}
              </p>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="answer-message" className="text-[13px] font-semibold">
                Message to the patient
              </Label>
              <FieldAssistButton
                field="patientMessage"
                value={draft.patientMessage}
                onChange={(patientMessage) => update({ patientMessage })}
                recorded={recorded('patientMessage')}
                firstName={patientFirstName}
              />
            </div>
            <DictationTextarea
              id="answer-message"
              rows={7}
              autoFocus
              placeholder="Answer the question in the patient's terms — what it means, what changes, what they do next…"
              value={draft.patientMessage}
              onValueChange={(patientMessage) => update({ patientMessage })}
            />
          </section>

          <section className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setToolkitOpen((v) => !v)}
              aria-expanded={toolkitOpen}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-left text-[13px] font-semibold hover:bg-muted"
            >
              <span>
                Also…{' '}
                <span className="font-normal text-muted-foreground">
                  dose change, labs, consultation, follow-up, ask CS
                </span>
              </span>
              <span className="text-xs text-muted-foreground">{toolkitOpen ? 'Hide' : 'Show'}</span>
            </button>

            {toolkitOpen && (
              <div className="flex flex-col gap-4 pl-1">
                <Sub title="Dose change">
                  <DoseChangePanel
                    medications={medications}
                    dosageOptions={dosageOptions}
                    changes={draft.doseChanges}
                    canChange
                    onChange={(doseChanges) => update({ doseChanges })}
                    patientGender={patientGender}
                    patientState={patientState}
                  />
                </Sub>

                <Sub title="Labs">
                  <LabOrdersPanel
                    patientState={patientState}
                    providers={labProviders}
                    scheduled={scheduledLabs}
                    orders={draft.labOrders}
                    cancelling={cancellingLabOrder}
                    onCancelScheduled={onCancelScheduledLab}
                    onChange={(labOrders) => update({ labOrders })}
                  />
                </Sub>

                <Sub title="Consultation">
                  <ConsultPanel
                    reviewId={questionId}
                    patientEmail={patientEmail}
                    patientStatusId={patientStatusId}
                    patientGender={patientGender}
                    consultations={consultations}
                    request={draft.consultation}
                    onChange={(consultation) => update({ consultation })}
                  />
                </Sub>

                <Sub
                  title="Ask customer service"
                  action={
                    <FieldAssistButton
                      field="csInstructions"
                      value={draft.csInstructions}
                      onChange={(csInstructions) => update({ csInstructions })}
                      recorded={recorded('csInstructions')}
                    />
                  }
                >
                  <Label htmlFor="answer-cs" className="sr-only">
                    Instructions for customer service
                  </Label>
                  <div id="answer-cs-hint" className="mb-2 flex flex-col gap-1 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">
                      Only for something customer service has to follow up on. Anything
                      written here flags the patient Follow Up Required for CS.
                    </p>
                    <p>
                      Tell the patient yourself in the message above; do not ask CS to pass
                      an answer on.
                    </p>
                    <p>Dose changes are flagged for CS automatically.</p>
                  </div>
                  <DictationTextarea
                    id="answer-cs"
                    rows={3}
                    aria-describedby="answer-cs-hint"
                    placeholder="e.g. Move his next shipment out a week."
                    value={draft.csInstructions}
                    onValueChange={(csInstructions) => update({ csInstructions })}
                  />
                </Sub>
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-2 border-t bg-muted/40 px-5 py-3.5">
          {problems.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-2.5">
            <Button variant="outline" onClick={close}>
              Close
            </Button>
            <Button
              onClick={() => setFinishing(true)}
              disabled={problems.length > 0}
              title={problems.length ? problems.join(' ') : undefined}
            >
              Finish — send answer
            </Button>
          </div>
        </div>

        {finishing && (
          <FinishQuestionDialog
            questionId={questionId}
            question={question}
            csComments={csComments}
            zendeskTicketId={zendeskTicketId}
            draft={draft}
            patientName={patientName}
            patientFirstName={patientFirstName}
            patientEmail={patientEmail}
            providerName={providerName}
            onEdit={() => setFinishing(false)}
            onChartSummary={(chartSummary) => update({ chartSummary })}
            onQuestionRecap={(questionRecap) => update({ questionRecap })}
            onFinished={(warning) => {
              unsaved.current = false
              onFinished(warning)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function isToolkitEmpty(draft: AnswerDraft): boolean {
  return (
    draft.doseChanges.length === 0 &&
    draft.labOrders.length === 0 &&
    draft.consultation === null &&
    !draft.csInstructions.trim()
  )
}

function Sub({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
          {title}
        </h4>
        {action}
      </div>
      {children}
    </section>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state.kind === 'clean') return null

  const text =
    state.kind === 'saving'
      ? 'Saving…'
      : state.kind === 'saved'
        ? `Saved ${shortTime(state.at)}`
        : state.kind === 'warned'
          ? 'Saved'
          : 'Not saved'

  return (
    <span
      className={`shrink-0 text-xs ${
        state.kind === 'error' ? 'font-medium text-destructive' : 'text-muted-foreground'
      }`}
    >
      {text}
    </span>
  )
}

function SaveBanner({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.kind !== 'error' && state.kind !== 'warned') return null
  const failed = state.kind === 'error'

  return (
    <p
      role="alert"
      className={`flex items-start gap-2 border-b px-5 py-2 text-xs font-medium ${
        failed
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
    >
      <span>{state.message}</span>
      {failed && (
        <button
          type="button"
          onClick={onRetry}
          className="ml-auto shrink-0 underline underline-offset-2 hover:no-underline"
        >
          Retry
        </button>
      )}
    </p>
  )
}
