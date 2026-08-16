'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { SparklesIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DictationTextarea } from '@/components/ui/dictation-textarea'
import { Label } from '@/components/ui/label'
import {
  FIELD_CONTRACT_NOTE,
  FIELD_LABELS,
  FIELD_STEER_PLACEHOLDERS,
  RECORDED_USE,
  type ReviewField,
} from '@/lib/ai/reviewFields'

/**
 * "Write this field out for me" for one box of the review flyout.
 *
 * The provider says what the field should say — usually in shorthand, the way
 * they would say it out loud — and the assistant writes it in the register that
 * field needs: third person for the chart, second person for the patient, plain
 * tasks for customer service.
 *
 * Four decisions carry the whole thing:
 *
 *  - **It drafts into a preview, not into the field.** The provider's text is
 *    still on screen next to it, and nothing is written until they say so. The
 *    older one-click assistant streamed straight into the box, which is faster
 *    and much worse: watching your own clinical reasoning get overwritten while
 *    you decide whether you like the replacement is not a decision anybody makes
 *    calmly. Undo remains afterwards regardless.
 *  - **The draft is editable where it is drafted.** Almost every draft is nearly
 *    right, and the fix is a word. Accepting first and editing in the field turns
 *    that word into a decision about whether to accept at all.
 *  - **Nothing regenerates behind a single click.** Getting this right is
 *    iterative, but iteration means changing the direction, not rerolling the
 *    same one — so the way back to the model is through the instructions, which
 *    are still there, and it says what it will cost.
 *  - **It shows what it is working from.** Everything the assistant is given is
 *    listed in the modal, verbatim, because the promise being made — nothing here
 *    came from anywhere but you — is only worth something if it can be checked.
 */

type Props = {
  field: ReviewField
  /** Current field contents. Sent so the draft keeps them rather than replacing. */
  value: string
  onChange: (value: string) => void
  /** `describeDecision(draft, { omit: field })` — the provider's other entries. */
  recorded: string
  /** Passed only for a field the patient reads, which is the only place a name
   *  belongs. Everywhere else the draft says "the patient". */
  firstName?: string | null
  disabled?: boolean
}

export function FieldAssistButton({
  field,
  value,
  onChange,
  recorded,
  firstName,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false)
  /** Which half of the modal is on screen: the direction, or what came back. */
  const [view, setView] = useState<'steer' | 'draft'>('steer')
  const [steer, setSteer] = useState('')
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The field's text before a draft was accepted, held for Undo. */
  const [previous, setPrevious] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const draftBox = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  const label = FIELD_LABELS[field]
  const hasDraft = draft.trim().length > 0

  // The cursor lands at the end of the draft the moment it stops moving, so the
  // first keystroke edits rather than replaces.
  useEffect(() => {
    if (view !== 'draft' || streaming || !draftBox.current) return
    const box = draftBox.current
    box.focus()
    box.setSelectionRange(box.value.length, box.value.length)
  }, [streaming, view])

  const stop = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    setStreaming(false)
  }, [])

  const close = useCallback(() => {
    stop()
    setOpen(false)
    setView('steer')
    setSteer('')
    setDraft('')
    setError(null)
  }, [stop])

  const generate = useCallback(async () => {
    const controller = new AbortController()
    abort.current = controller

    setError(null)
    setDraft('')
    setView('draft')
    setStreaming(true)

    try {
      const response = await fetch('/api/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field,
          existing: value,
          instructions: steer,
          recorded,
          firstName: firstName ?? '',
        }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        const message = (await response.text().catch(() => '')) || 'The assistant failed.'
        setError(message)
        setView('steer')
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let text = ''

      for (;;) {
        const { done, value: chunk } = await reader.read()
        if (done) break
        text += decoder.decode(chunk, { stream: true })
        setDraft(text)
      }

      if (!text.trim()) {
        setError('The assistant returned nothing. Give it a little more to go on.')
        setView('steer')
      }
    } catch (cause) {
      if (controller.signal.aborted) return
      console.error('[FieldAssistButton]', cause)
      setError('The assistant could not be reached.')
      setView('steer')
    } finally {
      if (abort.current === controller) abort.current = null
      setStreaming(false)
    }
  }, [field, firstName, recorded, steer, value])

  const accept = useCallback(() => {
    setPrevious(value)
    onChange(draft.trim())
    close()
  }, [close, draft, onChange, value])

  // A relay field can be written from the decisions alone — that is the point of
  // pressing this on an empty patient message. With none of the three there is
  // nothing to write out, and the honest place to say so is the disabled button.
  const canGenerate =
    steer.trim().length > 0 || value.trim().length > 0 || recorded.trim().length > 0

  const written = value.trim()

  return (
    <div className="flex items-center gap-2">
      {previous !== null && previous !== value && (
        <button
          type="button"
          onClick={() => {
            onChange(previous)
            setPrevious(null)
          }}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Undo
        </button>
      )}

      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={`Draft ${label.toLowerCase()} with AI`}
      >
        <SparklesIcon />
        AI draft
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close()
        }}
      >
        <DialogContent className="max-h-[90dvh] w-full gap-0 overflow-y-auto sm:max-w-xl">
          <DialogHeader className="pb-4 pr-8">
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>{FIELD_CONTRACT_NOTE}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 border-t pt-4">
            {view === 'steer' ? (
              <>
                {written && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-bold tracking-wider text-muted-foreground">
                      WHAT YOU HAVE WRITTEN
                    </span>
                    <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap">
                      {written}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      This is kept. It can be tidied and finished, not replaced.
                    </span>
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <Label
                    htmlFor={`assist-steer-${field}`}
                    className="text-xs font-bold tracking-wider text-muted-foreground"
                  >
                    WHAT SHOULD IT SAY
                  </Label>
                  <DictationTextarea
                    id={`assist-steer-${field}`}
                    rows={3}
                    autoFocus
                    placeholder={FIELD_STEER_PLACEHOLDERS[field]}
                    value={steer}
                    onValueChange={setSteer}
                  />
                  <span className="text-xs text-muted-foreground">
                    {RECORDED_USE[field] === 'relay'
                      ? 'Optional. With nothing here it writes the message from what this review already says.'
                      : 'Shorthand is enough. Writing it out is the job.'}
                  </span>
                </div>

                {/* Shown rather than described. The provider is being asked to trust
                    that nothing else reached the model, which they can only do by
                    reading what did. */}
                <details className="rounded-lg border px-3 py-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    What the assistant can see
                  </summary>
                  <div className="mt-2 flex flex-col gap-2 border-t pt-2">
                    {recorded.trim() ? (
                      <p className="text-xs leading-relaxed whitespace-pre-wrap">
                        {recorded.trim()}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Nothing else has been recorded in this review yet.
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      That, what you have written above,
                      {firstName?.trim()
                        ? ` the name to write to (${firstName.trim()}),`
                        : ''}{' '}
                      and nothing else. It has not been given the labs, the chart or the
                      patient&apos;s messages.
                    </p>
                  </div>
                </details>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label
                    htmlFor={`assist-draft-${field}`}
                    className="text-xs font-bold tracking-wider text-muted-foreground"
                  >
                    DRAFT
                  </Label>
                  {/* One textarea for both states rather than a preview that
                      becomes an input: swapping elements at the end of the stream
                      loses the scroll position and the focus. */}
                  <DictationTextarea
                    id={`assist-draft-${field}`}
                    ref={draftBox}
                    rows={9}
                    readOnly={streaming}
                    aria-busy={streaming}
                    placeholder={streaming ? 'Drafting…' : ''}
                    className="min-h-32 text-[13px] leading-relaxed"
                    value={draft}
                    onValueChange={setDraft}
                  />
                  <span className="text-xs text-muted-foreground">
                    {streaming
                      ? 'Drafting…'
                      : 'Edit it here. Nothing reaches the review until you use it.'}
                  </span>
                </div>

                {written && (
                  <details className="rounded-lg border px-3 py-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      What you had written
                    </summary>
                    <p className="mt-2 border-t pt-2 text-xs leading-relaxed whitespace-pre-wrap">
                      {written}
                    </p>
                  </details>
                )}
              </>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <DialogFooter className="mt-4">
            {streaming ? (
              <Button variant="outline" onClick={stop}>
                Stop
              </Button>
            ) : view === 'draft' ? (
              <>
                <Button variant="ghost" onClick={close}>
                  Cancel
                </Button>
                <Button variant="outline" onClick={() => setView('steer')}>
                  Change instructions
                </Button>
                <Button onClick={accept} disabled={!hasDraft}>
                  Use this draft
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={close}>
                  Cancel
                </Button>
                {hasDraft && (
                  <Button variant="outline" onClick={() => setView('draft')}>
                    Back to the draft
                  </Button>
                )}
                <Button onClick={generate} disabled={!canGenerate}>
                  {hasDraft ? 'Draft it again' : 'Draft it'}
                </Button>
              </>
            )}
          </DialogFooter>

          {hasDraft && view === 'steer' && !streaming && (
            <p className="mt-2 text-right text-xs text-muted-foreground">
              Drafting again replaces the draft you have, edits included.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
