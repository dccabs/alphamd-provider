'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { AI_TASK_LABELS, type AiTask } from '@/lib/ai/tasks'
import type { ReplyIdentity } from '@/lib/labReviews/replyIdentity'

/**
 * "Draft with AI" for a textarea that is written from the patient's history — the
 * escalation handoff note and the customer-service reply.
 *
 * The text streams into the field the provider is already looking at rather than
 * into a preview they then have to copy, which suits a field that is usually
 * empty when the button is pressed. The review flyout's own fields work the other
 * way round, through `FieldAssistButton`: there the provider has already written
 * something and a draft has to be inspected beside it before it lands.
 *
 * Two properties are deliberate and worth keeping:
 *
 *  - **The provider's text is never silently replaced.** Whatever is in the box
 *    is sent as the starting point, and while a draft streams the previous text
 *    is held so Undo can restore it. A tool that destroys typed clinical
 *    reasoning gets abandoned after the first time it happens.
 *  - **A stream in flight is cancellable**, because the honest response to a
 *    draft going the wrong direction is to stop it, not to wait it out.
 */

type Props = {
  reviewId: string
  task: AiTask
  /** Current field contents; sent so the model revises rather than replaces. */
  value: string
  onChange: (value: string) => void
  /** Optional free-text steer. */
  instructions?: string
  /** Only meaningful for `cs_reply`: who the reply is signed by. */
  identity?: ReplyIdentity
  disabled?: boolean
}

export function AssistButton({
  reviewId,
  task,
  value,
  onChange,
  instructions = '',
  identity,
  disabled,
}: Props) {
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previous, setPrevious] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  const stop = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    setStreaming(false)
  }, [])

  const run = useCallback(async () => {
    const controller = new AbortController()
    abort.current = controller

    const before = value
    setPrevious(before)
    setError(null)
    setStreaming(true)
    onChange('')

    try {
      const response = await fetch('/api/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId, task, existing: before, instructions, identity }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        const message = (await response.text().catch(() => '')) || 'The assistant failed.'
        setError(message)
        onChange(before)
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let text = ''

      for (;;) {
        const { done, value: chunk } = await reader.read()
        if (done) break
        text += decoder.decode(chunk, { stream: true })
        onChange(text)
      }

      // An empty completion would otherwise read as "the assistant wiped my
      // note", so put the provider's own words back instead.
      if (!text.trim()) {
        onChange(before)
        setError('The assistant returned nothing. Try again or write it manually.')
      }
    } catch (cause) {
      if (controller.signal.aborted) return
      console.error('[AssistButton]', cause)
      setError('The assistant could not be reached.')
      onChange(before)
    } finally {
      if (abort.current === controller) abort.current = null
      setStreaming(false)
    }
  }, [identity, instructions, onChange, reviewId, task, value])

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {streaming ? (
          <Button type="button" variant="outline" size="sm" onClick={stop}>
            Stop
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={run} disabled={disabled}>
            {AI_TASK_LABELS[task]}
          </Button>
        )}

        {streaming && <span className="text-xs text-muted-foreground">Drafting…</span>}

        {!streaming && previous !== null && previous !== value && (
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
      </div>

      {!streaming && !error && previous !== null && previous !== value && (
        <p className="text-xs text-muted-foreground">
          AI draft. Review it before saving — the wording is yours once you finalize.
        </p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
