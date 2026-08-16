'use client'

import { useId, useRef, useState, type ComponentProps } from 'react'
import { MicIcon, SquareIcon } from 'lucide-react'

import { Textarea } from '@/components/ui/textarea'
import { useDictation } from '@/components/use-dictation'
import { transcriptAt } from '@/lib/ai/dictation'
import { cn } from '@/lib/utils'

/**
 * A textarea a provider can talk into.
 *
 * The microphone sits in the box's own bottom-right corner rather than up beside
 * the label, because these fields are dictated into while reading a lab report:
 * the button belongs where the eye already is, and every field gets it in the
 * same place.
 *
 * Two decisions carry the rest:
 *
 *  - **Speech lands where the cursor was, and nothing already written is
 *    touched.** Dictation is used to add a sentence as often as to write the
 *    field, and the anchor is taken when the microphone opens so that later
 *    revisions to the same sentence keep replacing the same span.
 *  - **The box is read-only while it is listening.** The transcriber revises
 *    what it heard for as long as it is talking, which means rewriting the text
 *    it just wrote. If the provider could type into that span at the same time,
 *    one of the two would silently lose — so the microphone goes off first, which
 *    is one click and no ambiguity.
 */

type Props = Omit<ComponentProps<typeof Textarea>, 'value' | 'onChange'> & {
  value: string
  onValueChange: (value: string) => void
}

export function DictationTextarea({
  value,
  onValueChange,
  className,
  readOnly,
  ref,
  ...props
}: Props) {
  const statusId = useId()
  const box = useRef<HTMLTextAreaElement | null>(null)
  /** The text either side of the cursor when the microphone opened. */
  const [anchor, setAnchor] = useState({ before: '', after: '' })

  const dictation = useDictation({
    onSpeech: (speech) => onValueChange(transcriptAt(anchor.before, anchor.after, speech)),
  })

  const listening = dictation.status === 'listening'
  const busy = listening || dictation.status === 'connecting' || dictation.status === 'stopping'
  // A box the caller has made read-only has another writer in it — the AI draft
  // streaming in — and nothing can be dictated into it either. `|| busy` because
  // a session already running must keep its off switch even if the field turns
  // read-only underneath it; otherwise the microphone has no way to be stopped.
  const available = dictation.supported && (busy || (!readOnly && !props.disabled))

  const begin = () => {
    // `selectionStart` is where the caret is if the provider clicked into the
    // box, and the end of the text if they never focused it at all.
    const caret = box.current?.selectionStart ?? value.length
    const at = document.activeElement === box.current ? caret : value.length
    setAnchor({ before: value.slice(0, at), after: value.slice(at) })
    void dictation.start()
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <Textarea
          {...props}
          // Kept locally for the caret, and handed on to a caller that wants it
          // for its own reasons — the AI draft box scrolls itself as it streams.
          ref={(node) => {
            box.current = node
            if (typeof ref === 'function') ref(node)
            else if (ref) ref.current = node
          }}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          readOnly={readOnly || busy}
          aria-describedby={available ? statusId : props['aria-describedby']}
          className={cn(available && 'pr-11', className)}
        />

        {available && (
          <button
            type="button"
            onClick={() => (busy ? dictation.stop() : begin())}
            aria-pressed={listening}
            aria-label={listening ? 'Stop dictating' : 'Dictate into this field'}
            className={cn(
              'absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-full',
              'transition-colors',
              listening
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {listening ? (
              <SquareIcon className="size-3 fill-current" />
            ) : (
              <MicIcon className="size-4" />
            )}
          </button>
        )}
      </div>

      {available && (
        <p
          id={statusId}
          aria-live="polite"
          className={cn('text-xs', dictation.error ? 'text-destructive' : 'text-muted-foreground')}
        >
          {statusLine(dictation)}
        </p>
      )}
    </div>
  )
}

/**
 * One line, and empty when there is nothing to say — an idle field should not
 * carry a caption explaining that it is idle.
 */
function statusLine({
  status,
  error,
  seconds,
  stopReason,
}: ReturnType<typeof useDictation>): string {
  if (error) return error
  if (status === 'connecting') return 'Opening the microphone…'
  if (status === 'stopping') return 'Finishing up…'
  if (status === 'listening') return `Listening — ${clock(seconds)}. Click the square to stop.`
  if (stopReason === 'silence') return 'Stopped listening after 20 seconds of quiet.'
  if (stopReason === 'cap') return 'Stopped after 5 minutes. Click the microphone to carry on.'
  return ''
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
