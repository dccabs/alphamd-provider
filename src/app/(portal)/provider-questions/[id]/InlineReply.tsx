'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Info, Loader2, PanelRightOpen } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DictationTextarea } from '@/components/ui/dictation-textarea'
import { Label } from '@/components/ui/label'
import { shortTime } from '@/lib/labReviews/format'
import { toolkitItems, type AnswerDraft } from '@/lib/providerQuestions/answerDraft'
import { describeAnswer } from '@/lib/providerQuestions/finish'

import { FieldAssistButton } from '../../lab-reviews/[id]/FieldAssistButton'
import { saveAnswerDraftAction, takeProviderQuestionAction } from '../actions'
import { FinishQuestionDialog } from './FinishQuestionDialog'

/**
 * Reply to the patient from the main column, for a question that needs only
 * an answer.
 *
 * The message is the draft's `patientMessage`, so it and the Answer panel are
 * one answer: autosaved the same way while the question is yours, and handed
 * to the panel when the provider moves there. Sending finishes the question
 * through the same confirmation the panel uses, so what the patient and the
 * chart get is identical whichever way it was written.
 *
 * It sends the message and nothing else. A draft that already holds labs, a
 * dose change, a consultation, follow-up or a CS request has to be finished
 * from the panel, or those would go out without the provider seeing them.
 *
 * Key it on `draftUpdatedAt`: the panel's edits arrive as a new draft, and the
 * box must start again from them rather than keep its own copy.
 */

const DEBOUNCE_MS = 1200

type SaveState = { kind: 'clean' } | { kind: 'saving' } | { kind: 'saved'; at: string } | { kind: 'error'; message: string }

export function InlineReply({
  questionId,
  question,
  csComments,
  zendeskTicketId,
  patientName,
  patientFirstName,
  patientEmail,
  providerName,
  draft,
  mine,
  assignedToName,
  queued,
  onOpenAnswer,
  onFinished,
}: {
  questionId: string
  question: string
  csComments: string | null
  zendeskTicketId: string | null
  patientName: string
  patientFirstName: string | null
  patientEmail: string | null
  providerName: string
  draft: AnswerDraft
  mine: boolean
  assignedToName: string | null
  queued: boolean
  /** Open the Answer panel on this message, taking the question first if needed. */
  onOpenAnswer: (message: string) => void
  onFinished: (warning?: string) => void
}) {
  const [message, setMessage] = useState(draft.patientMessage)
  const [chartSummary, setChartSummary] = useState(draft.chartSummary)
  const [questionRecap, setQuestionRecap] = useState(draft.questionRecap)
  const [save, setSave] = useState<SaveState>({ kind: 'clean' })
  const [edits, setEdits] = useState(0)
  const [confirmTakeover, setConfirmTakeover] = useState(false)
  const [taking, setTaking] = useState(false)
  const [takeError, setTakeError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)

  const router = useRouter()
  const latest = useRef(draft.patientMessage)
  const unsaved = useRef(false)

  const blockers = toolkitItems(draft)
  const blocked = blockers.length > 0
  const empty = !message.trim()

  const edit = (next: string) => {
    latest.current = next
    setMessage(next)
    unsaved.current = true
    setEdits((n) => n + 1)
  }

  const persist = useCallback(async () => {
    if (!unsaved.current || !mine) return
    const snapshot = latest.current
    setSave({ kind: 'saving' })
    const result = await saveAnswerDraftAction(
      questionId,
      JSON.stringify({ ...draft, patientMessage: snapshot })
    )
    if (result.status === 'error') {
      setSave({ kind: 'error', message: result.message })
      return
    }
    if (latest.current === snapshot) unsaved.current = false
    setSave({ kind: 'saved', at: new Date().toISOString() })
  }, [draft, mine, questionId])

  useEffect(() => {
    if (edits === 0) return
    const timer = setTimeout(() => void persist(), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [edits, persist])

  const openPanel = async () => {
    await persist()
    onOpenAnswer(latest.current)
  }

  const send = async () => {
    setTakeError(null)
    if (!mine) {
      if (!queued && !confirmTakeover) {
        setConfirmTakeover(true)
        return
      }
      setTaking(true)
      const result = await takeProviderQuestionAction(questionId)
      setTaking(false)
      setConfirmTakeover(false)
      if (result.status === 'error') {
        setTakeError(result.message)
        return
      }
      router.refresh()
    }
    setFinishing(true)
  }

  const sendLabel = mine || queued ? 'Send reply & finish' : `Take over & send reply`

  return (
    <section className="flex flex-col gap-3 border-t px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="inline-reply" className="text-[13px] font-semibold">
          Quick Reply
        </Label>
        <div className="flex items-center gap-2">
          <SaveIndicator state={save} />
          <FieldAssistButton
            field="patientMessage"
            value={message}
            onChange={edit}
            recorded={describeAnswer(
              { ...draft, patientMessage: message },
              question,
              { omit: 'patientMessage' }
            )}
            firstName={patientFirstName}
          />
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-900">
        <Info className="mt-px size-3.5 shrink-0" />
        <p>
          This only messages the patient
          {zendeskTicketId ? ` (a reply on ticket #${zendeskTicketId})` : ' (a new Zendesk ticket)'}{' '}
          and finishes the question. To send labs, change a dose, schedule a consultation or
          alert customer service, use the{' '}
          <button
            type="button"
            onClick={() => void openPanel()}
            className="font-semibold underline underline-offset-2 hover:no-underline"
          >
            Answer panel
          </button>{' '}
          instead.
        </p>
      </div>

      <DictationTextarea
        id="inline-reply"
        rows={5}
        placeholder="Answer the question in the patient's terms — what it means, what changes, what they do next…"
        value={message}
        onValueChange={edit}
      />

      {blocked && (
        <p
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900"
        >
          The saved answer also has {joinWords(blockers)}. Finish from the Answer panel so{' '}
          {blockers.length > 1 ? 'they go' : 'it goes'} out too.
        </p>
      )}

      {!mine && edits > 0 && (
        <p className="text-xs text-muted-foreground">
          Not saved until you take the question or send the reply.
        </p>
      )}
      {save.kind === 'error' && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {save.message}
        </p>
      )}
      {takeError && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {takeError}
        </p>
      )}
      {confirmTakeover && (
        <p role="alert" className="text-xs font-medium text-amber-900">
          {assignedToName ?? 'Another provider'} has this question. Press again to take it over and
          send your reply.
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        {blocked ? (
          <Button size="sm" onClick={() => void openPanel()}>
            <PanelRightOpen />
            Open Answer panel
          </Button>
        ) : (
          <>
            {confirmTakeover && (
              <Button variant="outline" size="sm" onClick={() => setConfirmTakeover(false)}>
                Cancel
              </Button>
            )}
            <Button size="sm" disabled={empty || taking} onClick={() => void send()}>
              {taking && <Loader2 className="animate-spin" />}
              {confirmTakeover ? `Take over from ${assignedToName ?? 'them'} & send` : sendLabel}
            </Button>
          </>
        )}
      </div>

      {finishing && (
        <FinishQuestionDialog
          questionId={questionId}
          question={question}
          csComments={csComments}
          zendeskTicketId={zendeskTicketId}
          draft={{ ...draft, patientMessage: message, chartSummary, questionRecap }}
          patientName={patientName}
          patientFirstName={patientFirstName}
          patientEmail={patientEmail}
          providerName={providerName}
          onEdit={() => setFinishing(false)}
          onChartSummary={setChartSummary}
          onQuestionRecap={setQuestionRecap}
          onFinished={(warning) => {
            unsaved.current = false
            onFinished(warning)
          }}
        />
      )}
    </section>
  )
}

function joinWords(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state.kind === 'clean') return null
  const text =
    state.kind === 'saving' ? 'Saving…' : state.kind === 'saved' ? `Saved ${shortTime(state.at)}` : 'Not saved'
  return (
    <span
      className={`text-xs ${state.kind === 'error' ? 'font-medium text-destructive' : 'text-muted-foreground'}`}
    >
      {text}
    </span>
  )
}
