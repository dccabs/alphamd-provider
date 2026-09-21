'use client'

import { useCallback, useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { SummaryBlocks } from '@/components/summary-blocks'
import { parseSummary } from '@/lib/labReviews/summaryMarkdown'

/**
 * The AI tab on a Provider Question. Written when the screen opens, from the
 * question plus the same patient history a Lab Review summary uses. Not stored:
 * the question is the input, and a reload writes it again.
 */
export function QuestionSummary({ questionId }: { questionId: string }) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'writing' | 'ready' | 'error'>('writing')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const write = useCallback(async (signal: AbortSignal) => {
    setStatus('writing')
    setText('')
    setError(null)

    try {
      const response = await fetch('/api/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'questionSummary', reviewId: questionId }),
        signal,
      })

      if (!response.ok || !response.body) {
        const message = (await response.text().catch(() => '')) || 'The assistant failed.'
        setError(message)
        setStatus('error')
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let next = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        next += decoder.decode(value, { stream: true })
        setText(next)
      }

      if (!next.trim()) {
        setError('The assistant returned nothing.')
        setStatus('error')
        return
      }
      setStatus('ready')
    } catch (cause) {
      if (signal.aborted) {
        if (signal.reason === 'timeout') {
          setError('The summary is taking too long. Rewrite to try again.')
          setStatus('error')
        }
        return
      }
      console.error('[QuestionSummary]', cause)
      setError('The assistant could not be reached.')
      setStatus('error')
    }
  }, [questionId])

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort('timeout'), 90_000)
    void write(controller.signal)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [write, attempt])

  const blocks = status === 'ready' ? parseSummary(text) : []

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">AI</Badge>
        <span className="text-xs text-muted-foreground">
          {status === 'writing'
            ? 'Writing from the question and the chart…'
            : status === 'ready'
              ? 'From the question and the chart'
              : 'Not written'}
        </span>
        {status !== 'writing' && (
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="ml-auto text-xs text-muted-foreground underline underline-offset-2 hover:no-underline"
          >
            Rewrite
          </button>
        )}
      </div>
      {status === 'error' && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {status === 'ready' ? (
        <SummaryBlocks blocks={blocks} />
      ) : (
        text && (
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {text}
          </p>
        )
      )}
    </div>
  )
}
